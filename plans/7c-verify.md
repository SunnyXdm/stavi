Phase 7c verification

1. Explorer navigation
   - Open Explorer in a session. PASS: breadcrumb shows session folder.
   - Tap a subfolder. PASS: breadcrumb updates, list shows subfolder contents.
   - Tap the root breadcrumb segment. PASS: back to session folder.

2. Explorer multi-select + delete
   - Long-press a file → selection mode activates, file is checked.
   - Tap two more files → three checked.
   - Tap Delete → confirmation dialog → confirm.
   - PASS: files removed from list. Server confirms deletion via fs.list.

3. Explorer move
   - Select two files. Tap Move → DestinationPicker opens.
   - Pick a subfolder. Tap "Move here".
   - PASS: files disappear from current dir, appear in the subfolder.

4. Explorer copy
   - Select a file. Tap Copy → pick destination.
   - PASS: original file still exists, copy exists in destination.

5. Explorer metadata
   - Select one file. Tap Info.
   - PASS: EntryMetaSheet shows size, modified time, permissions, full path.

6. Explorer → Editor integration
   - Tap a file (not in selection mode).
   - PASS: Editor opens with that file in a new tab.

7. Explorer → Terminal integration
   - Long-press a folder → select → Tap "Open in Terminal".
   - PASS: Terminal opens with cwd = that folder.

8. System search
   - Open Tools sheet → System Search.
   - Search for a known filename or content string.
   - PASS: results appear with file paths and match previews.
   - Tap a result that is inside a session folder.
   - PASS: Editor opens the file.

9. Batch operation progress
   - Select 10+ files. Tap Delete.
   - PASS: progress indicator visible during deletion (not instant for 10+ files).

10. Path traversal rejection
    - Via a scratch WS client, send fs.batchDelete { paths: ['/etc/passwd'] }.
    - PASS: server rejects with "path outside workspace" error.
