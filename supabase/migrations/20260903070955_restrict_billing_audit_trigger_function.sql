-- This function is invoked only by the audit trigger and must not be callable
-- through the public REST API.
revoke all on function public.confirm_payment_from_billing_audit() from public;
revoke all on function public.confirm_payment_from_billing_audit() from anon;
revoke all on function public.confirm_payment_from_billing_audit() from authenticated;
