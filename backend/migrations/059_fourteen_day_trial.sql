begin;
update public.plan_credit_config set credits_per_period=200, allocation_type='one_time', rollover_enabled=false, expiry_enabled=true where plan_code='explorer';
create table if not exists public.trial_credit_upgrades (
 user_id text primary key, upgraded_at timestamptz not null default now()
);
alter table public.trial_credit_upgrades enable row level security;
revoke all on public.trial_credit_upgrades from public,anon,authenticated;
grant select,insert on public.trial_credit_upgrades to service_role;

-- Bring still-active trial accounts up to a total welcome allocation of 200, once.
do $$ declare r record; issued integer; extra integer; begin
 for r in select w.* from public.credit_wallets w join public.users u on u.id::text=w.user_id
  where u.created_at::timestamptz>now()-interval '14 days'
   and not exists(select 1 from public.user_subscriptions s where s.user_id=w.user_id and s.status in ('active','trial','trialing') and s.plan_key not in ('explorer','free_trial'))
 loop
  select coalesce(sum(credits),0) into issued from public.credit_transactions where user_id=r.user_id and status='completed' and transaction_type='allocation'
   and description in ('explorer initial credit allocation','free_trial initial credit allocation','Trial credit increase to 200');
  if issued=0 and r.free_allocation_issued then issued:=least(50,r.lifetime_credits_issued); end if;
  extra:=greatest(0,200-issued);
  insert into public.stripe_credit_grants(user_id,reference) values(r.user_id,'welcome:increase-to-200') on conflict do nothing;
  if found and extra>0 then perform public.grant_credits(r.user_id,extra,'allocation','Trial credit increase to 200',null); end if;
 end loop;
end $$;

create or replace function public.expire_trial_credits_once(p_user_id text)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare w credit_wallets%rowtype; welcome integer; amount integer; deducted integer;
begin
 select * into w from public.credit_wallets where user_id=p_user_id for update;
 if not found then return jsonb_build_object('ok',true,'balance',0); end if;
 insert into public.stripe_credit_grants(user_id,reference) values(p_user_id,'trial:expired') on conflict do nothing;
 if not found then return jsonb_build_object('ok',true,'balance',w.available_credits); end if;
 select coalesce(sum(credits),0) into welcome from public.credit_transactions where user_id=p_user_id and status='completed' and transaction_type='allocation'
  and description in ('explorer initial credit allocation','free_trial initial credit allocation','Trial credit increase to 200');
 if not exists(select 1 from public.credit_transactions where user_id=p_user_id and description in ('explorer initial credit allocation','free_trial initial credit allocation'))
  and w.free_allocation_issued and not exists(select 1 from public.credit_transactions where user_id=p_user_id and transaction_type='allocation' and description like '% initial credit allocation' and description not in ('explorer initial credit allocation','free_trial initial credit allocation')) then welcome:=welcome+least(50,w.lifetime_credits_issued); end if;
 select coalesce(sum(abs(credits)),0) into deducted from public.credit_transactions where user_id=p_user_id and transaction_type='admin_adjustment' and credits<0;
 amount:=least(w.available_credits,greatest(0,welcome-w.lifetime_credits_used-w.held_credits-deducted));
 if amount>0 then perform public.admin_deduct_credits(p_user_id,amount,'Welcome credits expired after 14-day trial'); end if;
 return jsonb_build_object('ok',true,'balance',w.available_credits-amount);
end;
$$;
revoke all on function public.expire_trial_credits_once(text) from public,anon,authenticated;
grant execute on function public.expire_trial_credits_once(text) to service_role;

-- The payment receipt, removal of trial credit and paid allocation are one transaction.
create or replace function public.grant_stripe_credits_once(p_user_id text,p_reference text,p_amount integer,p_reason text)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare w credit_wallets%rowtype; unused integer; welcome integer; deducted integer;
begin
 if p_reference is null or length(p_reference)=0 or p_amount<0 then raise exception 'Invalid Stripe credit grant'; end if;
 insert into public.stripe_credit_grants(user_id,reference) values(p_user_id,p_reference) on conflict do nothing;
 if not found then return jsonb_build_object('ok',true,'granted',false); end if;
 if exists(select 1 from public.credit_transactions where user_id=p_user_id and description=p_reason and status='completed') then
  return jsonb_build_object('ok',true,'granted',false);
 end if;
 if p_reference like 'subscription:%' then
  insert into public.trial_credit_upgrades(user_id) select p_user_id
    where not exists(select 1 from public.credit_transactions where user_id=p_user_id and status='completed' and description like '%subscription credit allocation [%')
    on conflict do nothing;
  if found then
   select * into w from public.credit_wallets where user_id=p_user_id for update;
   select coalesce(sum(credits),0) into welcome from public.credit_transactions
    where user_id=p_user_id and status='completed' and transaction_type='allocation'
      and description in ('explorer initial credit allocation','free_trial initial credit allocation','Trial credit increase to 200');
   if not exists(select 1 from public.credit_transactions where user_id=p_user_id and description in ('explorer initial credit allocation','free_trial initial credit allocation'))
      and w.free_allocation_issued and not exists(select 1 from public.credit_transactions where user_id=p_user_id and transaction_type='allocation' and description like '% initial credit allocation' and description not in ('explorer initial credit allocation','free_trial initial credit allocation')) then welcome := welcome + least(50,coalesce(w.lifetime_credits_issued,0)); end if;
   select coalesce(sum(abs(credits)),0) into deducted from public.credit_transactions where user_id=p_user_id and transaction_type='admin_adjustment' and credits<0;
   unused := least(coalesce(w.available_credits,0),greatest(0,welcome-coalesce(w.lifetime_credits_used,0)-coalesce(w.held_credits,0)-deducted));
   if exists(select 1 from public.stripe_credit_grants where user_id=p_user_id and reference='trial:expired') then unused:=0; end if;
   if unused>0 then perform public.admin_deduct_credits(p_user_id,unused,'Unused trial credits removed on upgrade'); end if;
  end if;
 end if;
 if p_amount>0 then perform public.grant_credits(p_user_id,p_amount,'allocation',p_reason,null); end if;
 return jsonb_build_object('ok',true,'granted',true);
end;
$$;

-- A failed pre-upgrade AI job cannot return trial credits into the paid wallet.
do $$ begin
 if to_regprocedure('public.release_credits_before_trial_policy(uuid,text)') is null then
  alter function public.release_credits(uuid,text) rename to release_credits_before_trial_policy;
 end if;
end $$;
create or replace function public.release_credits(p_generation_id uuid,p_idempotency_key text)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare h credit_transactions%rowtype; result jsonb; already boolean;
begin
 select * into h from public.credit_transactions where generation_id=p_generation_id and transaction_type='hold' and idempotency_key=p_idempotency_key;
 if h.user_id is not null then perform 1 from public.credit_wallets where user_id=h.user_id for update; end if;
 select exists(select 1 from public.credit_transactions where idempotency_key=p_idempotency_key||'_release') into already;
 result := public.release_credits_before_trial_policy(p_generation_id,p_idempotency_key);
 if not already and coalesce((result->>'ok')::boolean,false) and (exists(
  select 1 from public.trial_credit_upgrades u where u.user_id=h.user_id and h.created_at<=u.upgraded_at
 ) or exists(select 1 from public.stripe_credit_grants g where g.user_id=h.user_id and g.reference='trial:expired' and h.created_at<=g.created_at)) then
  perform public.admin_deduct_credits(h.user_id,abs(h.credits),'Pre-upgrade trial credit release expired');
 end if;
 return result;
end;
$$;
revoke all on function public.release_credits_before_trial_policy(uuid,text) from public,anon,authenticated;
grant execute on function public.release_credits_before_trial_policy(uuid,text) to service_role;
revoke all on function public.release_credits(uuid,text) from public,anon,authenticated;
grant execute on function public.release_credits(uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
