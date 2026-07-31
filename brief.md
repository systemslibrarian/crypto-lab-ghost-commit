Category: Secret Management / Supply Chain
Slug: crypto-lab-ghost-commit
One-liner: Commit an API key, "delete" it in the next commit, and watch it sit in git history forever — then watch an entropy scanner find it in seconds, and learn why rotation, not deletion, is the only fix.

Why this is a better build than Stream Ward: it needs no "this is modelled" caveat. Everything is real in-browser — real SHA-1/SHA-256 commit hashing, real Shannon-entropy scoring, real base64/hex detection. It's the §11.1 failure demonstrated with actual math, which is the purest version of your lab's ethos.

The three things it must show:

The persistence. A toy commit graph (5–6 commits). The user "commits" a file containing API_KEY = "sk_live_4eC39H...". Two commits later they "remove" it — the file no longer shows the key at HEAD. Then: a "walk history" button that traverses the parent chain and surfaces the key from the earlier commit's blob, with the real commit SHA that still contains it. The lesson lands: HEAD is clean, history is not.
The detection (real entropy math). A scanner panel that walks every blob and scores each string with Shannon entropy — showing why acmepay_live_4eC39HqLyjWDarjtT1zdp7dc scores ~4.8 bits/char and trips the threshold while ordinary English prose scores ~2.5. A live histogram. This is exactly how gitleaks/trufflehog work, and it's honest, real computation. Let the user paste their own string and watch it score.
The (non-)fix. A "delete the file" button that removes it from HEAD — and the scanner still finds it in history. Then a "rotate the key" action that renders the leaked value inert. The §11.1 rule made visceral: deletion doesn't undo exposure; rotation does.

Signature moment: the "walk history" reveal — the key you thought you deleted, surfacing with a real commit hash — followed by the entropy histogram lighting up on it.

Ties to blueprint: §11.1 directly. Also reinforces the Semgrep hardcoded-secret-assignment rule in Appendix B (the regex there mirrors the entropy heuristic this lab teaches) and the CI-scanning USE guidance. It's the interactive proof behind that whole control.

Libraries: Web Crypto for SHA, hand-rolled Shannon entropy (trivial), no backend, no simulation.