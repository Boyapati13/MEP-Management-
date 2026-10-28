## 2026-03-31 - Prepared Statements & Constant-Time Password Verification
**Learning:** Using `crypto.timingSafeEqual` with direct `Buffer` output from `crypto.scryptSync()` prevents timing side-channels and removes redundant hex string allocations.
**Action:** Always guard `crypto.timingSafeEqual` with strict buffer length checks (`checkBuf.length === hashBuf.length`) to prevent `TypeError` exceptions.
