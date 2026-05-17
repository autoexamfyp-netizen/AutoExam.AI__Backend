-- Password recovery: verify email belongs to a registered account before sending OTP.
-- Callable by anon via PostgREST (no service-role key in the app).

CREATE OR REPLACE FUNCTION public.email_exists_for_password_recovery(check_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF check_email IS NULL OR length(trim(check_email)) = 0 THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE lower(trim(u.email)) = lower(trim(check_email))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.email_exists_for_password_recovery(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_exists_for_password_recovery(text) TO anon, authenticated;
