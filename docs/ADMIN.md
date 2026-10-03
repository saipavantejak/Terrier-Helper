# College administrator setup and operation

1. In the TerrierHelper Vercel project, add a **Production** server-side environment variable named `ADMIN_ACCESS_KEY`. Use a password manager to generate a random value of at least 32 characters and save it securely. Do not use a `VITE_` prefix or paste the value into chat/GitHub.
2. Redeploy after saving the environment variable. Existing Gemini and database configuration stays in place.
3. Open `/admin` and sign in with that access key. Students use `/` and cannot upload or change documents.
4. Upload a text-based PDF. Wait for indexing, open **Review PDF**, then choose **Publish**. Drafts are invisible to students.
5. Open the student page in another browser/session and ask a question supported by the published document. Verify the exact quotation and page link.
6. Use **Withdraw** to stop new answers and PDF access immediately. Reindexing automatically withdraws the source; publish again after review. Delete permanently removes its file and index.

College documents do not expire with a staff browser cookie. Admin sign-in lasts eight hours. The bootstrap cookie is signed and bound to the browser's anonymous session; signing out clears it. Rotating the key and redeploying invalidates all existing standalone admin cookies. For per-user revocation, staff invitations, MFA, and named audit attribution, integrate the institution's existing identity provider through the documented authentication adapter.

Uploads, publication changes, deletion, reindexing and sign-in are recorded as operational events with a hashed actor and request ID; document contents and access keys are excluded. Logs are retained for 30 days by the existing cleanup job. This is an operational audit trail, not a tamper-proof compliance archive.

The visual theme is inspired by St. Francis College, Brooklyn. This deployment remains an independent project and does not claim official college endorsement. Publish only documents the college authorizes for public student access.
