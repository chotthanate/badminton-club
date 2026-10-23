export class PostCommitAuditError extends Error {
  constructor(cause) {
    super("บันทึกข้อมูลแล้ว แต่บันทึกประวัติการแก้ไขไม่สำเร็จ ไม่ต้องกดบันทึกซ้ำ", { cause });
    this.name = "PostCommitAuditError";
    this.code = "POST_COMMIT_AUDIT_FAILED";
    this.committed = true;
  }
}

// Only call after every required write has succeeded, as the final step of an action.
// Both Supabase's returned errors and thrown network errors are post-commit warnings.
export async function writePostCommitAudit(writeAudit) {
  try {
    const result = await writeAudit();
    if (result?.error) throw result.error;
    return result;
  } catch (cause) {
    throw new PostCommitAuditError(cause);
  }
}

// A successful write remains successful even when its audit or subsequent refresh fails.
// In particular, callers must close/reset saved forms rather than invite a duplicate write.
export async function runMutationLifecycle({ action, refresh, onSaved, onError, onRefreshError }) {
  let auditWarning = "";
  try {
    await action();
  } catch (error) {
    if (!(error instanceof PostCommitAuditError)) {
      onError(error);
      return false;
    }
    auditWarning = error.message;
  }
  onSaved(auditWarning);
  try {
    await refresh();
  } catch (error) {
    onRefreshError(error, auditWarning);
  }
  return true;
}
