begin;
create table if not exists public.stripe_credit_grants (
 user_id text not null, reference text not null, created_at timestamptz not null default now(),
 primary key(user_id,reference)
);
alter table public.stripe_credit_grants enable row level security;
revoke all on public.stripe_credit_grants from public,anon,authenticated;
grant select,insert on public.stripe_credit_grants to service_role;
create or replace function public.grant_stripe_credits_once(p_user_id text,p_reference text,p_amount integer,p_reason text)
returns jsonb language plpgsql set search_path=public,pg_temp as $$
begin
 if p_reference is null or length(p_reference)=0 or p_amount<0 then raise exception 'Invalid Stripe credit grant'; end if;
 insert into public.stripe_credit_grants(user_id,reference) values(p_user_id,p_reference) on conflict do nothing;
 if not found then return jsonb_build_object('ok',true,'granted',false); end if;
 -- Recognise legacy initial grants as well as calls using the new receipt.
 if exists(select 1 from public.credit_transactions where user_id=p_user_id and description=p_reason and status='completed') then
   return jsonb_build_object('ok',true,'granted',false);
 end if;
 if p_amount>0 then perform public.grant_credits(p_user_id,p_amount,'allocation',p_reason,null); end if;
 return jsonb_build_object('ok',true,'granted',true);
end;
$$;
revoke all on function public.grant_stripe_credits_once(text,text,integer,text) from public,anon,authenticated;
grant execute on function public.grant_stripe_credits_once(text,text,integer,text) to service_role;
notify pgrst,'reload schema';
commit;
