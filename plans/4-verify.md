Phase 4a verification

1. Open editor, tree visible rooted at session.folder.
2. Expand folders. Tap a file. It opens in a tab.
3. Long-press a file → Rename → tree updates.
4. Long-press a folder → Open in Terminal Here → terminal tab opens with matching pwd.
5. Open three files, navigate Home and back → same three tabs restored, same active tab.
6. Toggle "Show hidden files" → .git directory now visible in the tree.

Phase 4b verification

1. Open a .ts file → syntax highlighting visible.
2. Edit the file → dirty dot appears on the tab.
3. Tap Save → file saved on server; dirty dot disappears; git panel now shows the file modified.
4. Open another file; original content preserved; new content loads within 500 ms.
5. Open a 50k-line file → loads in <2 s, scroll is smooth.
6. Open a .png → binary placeholder shown, no WebView mounted.
7. Try to open a 50 MB file → refusal dialog.
