export async function authenticateBackofficeCode(accessCode, { signInOwner, signInStaff }) {
  let ownerResult = null;
  try {
    ownerResult = await signInOwner(accessCode);
  } catch {
    ownerResult = null;
  }
  if (ownerResult && !ownerResult.error) return "admin";
  await signInStaff(accessCode);
  return "staff";
}
