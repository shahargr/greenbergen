-- 242b THE TERMS HELPERS ARE INTERNAL
--
-- The security advisor, right after 242: package_terms_problem,
-- package_stage_amount and the due-date trigger function were callable over
-- /rest/v1/rpc by signed-in users. They are only ever called from inside
-- homeowner_post_internal and a trigger, so nobody needs them directly.
-- stage_collected_by stays callable by authenticated: v_contractor_payouts_due
-- is a security_invoker view and calls it, and it says only who collects.

revoke execute on function public.package_terms_problem(text, integer) from public, anon, authenticated;
revoke execute on function public.package_stage_amount(text, text, integer) from public, anon, authenticated;
revoke execute on function public.fn_project_bookings_stage_due() from public, anon, authenticated;
