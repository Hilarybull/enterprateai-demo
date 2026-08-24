-- EnterprateAI Demo Workspace Seed
-- Run this in the Supabase SQL Editor (https://supabase.com → your project → SQL Editor)
-- Safe to run multiple times: only inserts if the demo user has no workspace yet.

DO $$
DECLARE
  v_user_id TEXT := 'demoacc#@enterprate.ai';
  v_workspace_id UUID := '6d4fb924-6f5f-4fda-bbfd-c24113575ede';
BEGIN

  -- Only seed if demo user has no workspace
  IF NOT EXISTS (SELECT 1 FROM workspaces WHERE user_id = v_user_id) THEN

    INSERT INTO workspaces (id, user_id, name, data, created_at, updated_at)
    VALUES (
      v_workspace_id,
      v_user_id,
      'Apex Consulting Ltd',
      jsonb_build_object(
        'workspace_profile', jsonb_build_object(
          'company_name', 'Apex Consulting Ltd',
          'tagline', 'Strategic growth for ambitious businesses',
          'about_company', 'Apex Consulting is a London-based advisory firm helping ambitious SMEs unlock growth through data-driven strategy, financial planning, and operational excellence. Founded in 2021, we have supported over 40 businesses across retail, tech, and professional services.',
          'primary_industry', 'Business Consulting',
          'business_type', 'limited_company',
          'operating_stage', 'growth',
          'delivery_model', 'hybrid',
          'city', 'London',
          'country', 'United Kingdom',
          'email', 'hello@apexconsulting.co.uk',
          'phone_number', '+44 20 7946 0123',
          'website', 'www.apexconsulting.co.uk',
          'target_customer_type', 'b2b',
          'primary_revenue_model', 'project_based',
          'key_offering_focus', 'Strategic advisory and growth planning for UK SMEs',
          'vision', 'To be the go-to growth partner for ambitious UK SMEs',
          'mission', 'Helping businesses unlock their full potential through practical, data-driven strategy',
          'employee_count', 8,
          'core_values', ARRAY['Integrity', 'Results-first', 'Partnership'],
          'services', jsonb_build_array(
            jsonb_build_object('service_name', 'Strategy Sprint', 'price', 2500, 'unit', 'project', 'description', '4-week intensive strategy and planning session'),
            jsonb_build_object('service_name', 'Business Plan', 'price', 1500, 'unit', 'document', 'description', 'Investor-ready business plan with financial projections'),
            jsonb_build_object('service_name', 'Market Analysis', 'price', 800, 'unit', 'report', 'description', 'Competitor and market sizing deep-dive report')
          )
        ),
        'business_profile', jsonb_build_object(
          'business_name', 'Apex Consulting Ltd',
          'primary_industry', 'Business Consulting',
          'location', 'London, United Kingdom',
          'currency', 'GBP',
          'business_type', 'limited_company',
          'about', 'Strategic advisory for ambitious SMEs across the UK.'
        ),
        'catalogue', jsonb_build_object(
          'products', jsonb_build_array(
            jsonb_build_object('id', 'prod-001', 'name', 'Strategy Sprint', 'category', 'Service', 'price', 2500, 'currency', 'GBP', 'unit', 'project', 'description', '4-week intensive strategy session', 'active', true),
            jsonb_build_object('id', 'prod-002', 'name', 'Business Plan', 'category', 'Service', 'price', 1500, 'currency', 'GBP', 'unit', 'document', 'description', 'Investor-ready business plan with financials', 'active', true),
            jsonb_build_object('id', 'prod-003', 'name', 'Market Analysis Report', 'category', 'Service', 'price', 800, 'currency', 'GBP', 'unit', 'report', 'description', 'Deep-dive competitor and market sizing analysis', 'active', true),
            jsonb_build_object('id', 'prod-004', 'name', 'Growth Advisory Retainer', 'category', 'Retainer', 'price', 1200, 'currency', 'GBP', 'unit', 'month', 'description', 'Ongoing monthly advisory and support', 'active', true)
          ),
          'customers', jsonb_build_array(
            jsonb_build_object('id', 'cust-001', 'name', 'Meridian Tech Ltd', 'email', 'accounts@meridiantech.co.uk', 'phone', '+44 7700 900111', 'type', 'business', 'city', 'London', 'country', 'UK', 'active', true),
            jsonb_build_object('id', 'cust-002', 'name', 'Parkview Retail Group', 'email', 'finance@parkviewretail.com', 'phone', '+44 7700 900222', 'type', 'business', 'city', 'Manchester', 'country', 'UK', 'active', true),
            jsonb_build_object('id', 'cust-003', 'name', 'BlueSky Ventures', 'email', 'info@bluesky.vc', 'phone', '+44 7700 900333', 'type', 'business', 'city', 'Edinburgh', 'country', 'UK', 'active', true)
          ),
          'vendors', jsonb_build_array(
            jsonb_build_object('id', 'vend-001', 'name', 'CloudForce Hosting', 'email', 'billing@cloudforce.io', 'category', 'Software', 'active', true),
            jsonb_build_object('id', 'vend-002', 'name', 'London Office Supplies', 'email', 'orders@lossupplies.co.uk', 'category', 'Office', 'active', true)
          )
        ),
        'financials', jsonb_build_object(
          'invoices', jsonb_build_array(
            jsonb_build_object(
              'id', 'inv-001',
              'number', 'INV-001',
              'customer_id', 'cust-001',
              'customer_name', 'Meridian Tech Ltd',
              'date', '2026-06-15',
              'due_date', '2026-07-15',
              'status', 'paid',
              'currency', 'GBP',
              'items', jsonb_build_array(
                jsonb_build_object('product_id', 'prod-001', 'name', 'Strategy Sprint', 'qty', 1, 'price', 2500)
              ),
              'subtotal', 2500,
              'total', 2500
            ),
            jsonb_build_object(
              'id', 'inv-002',
              'number', 'INV-002',
              'customer_id', 'cust-002',
              'customer_name', 'Parkview Retail Group',
              'date', '2026-07-01',
              'due_date', '2026-08-01',
              'status', 'sent',
              'currency', 'GBP',
              'items', jsonb_build_array(
                jsonb_build_object('product_id', 'prod-002', 'name', 'Business Plan', 'qty', 1, 'price', 1500)
              ),
              'subtotal', 1500,
              'total', 1500
            ),
            jsonb_build_object(
              'id', 'inv-003',
              'number', 'INV-003',
              'customer_id', 'cust-003',
              'customer_name', 'BlueSky Ventures',
              'date', '2026-07-28',
              'due_date', '2026-08-28',
              'status', 'draft',
              'currency', 'GBP',
              'items', jsonb_build_array(
                jsonb_build_object('product_id', 'prod-003', 'name', 'Market Analysis Report', 'qty', 1, 'price', 800),
                jsonb_build_object('product_id', 'prod-002', 'name', 'Business Plan', 'qty', 1, 'price', 1500)
              ),
              'subtotal', 2300,
              'total', 2300
            )
          ),
          'expenses', jsonb_build_array(
            jsonb_build_object('id', 'exp-001', 'description', 'CloudForce Hosting - Monthly', 'amount', 120, 'currency', 'GBP', 'category', 'Software', 'date', '2026-07-01', 'vendor_id', 'vend-001'),
            jsonb_build_object('id', 'exp-002', 'description', 'Office Supplies Q3', 'amount', 85, 'currency', 'GBP', 'category', 'Office', 'date', '2026-07-15', 'vendor_id', 'vend-002'),
            jsonb_build_object('id', 'exp-003', 'description', 'LinkedIn Premium', 'amount', 60, 'currency', 'GBP', 'category', 'Marketing', 'date', '2026-08-01', 'vendor_id', null)
          )
        )
      ),
      NOW(),
      NOW()
    );

    RAISE NOTICE 'Demo workspace created: %', v_workspace_id;
  ELSE
    RAISE NOTICE 'Demo user already has a workspace. Skipping.';
  END IF;

END $$;
