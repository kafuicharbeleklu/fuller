### Observation & Cause
- **Cause**: In `tests/sessionPicker.test.tsx`, key sequences wrote to `screen.stdin` and waited on fixed timeouts (`setTimeout(..., 30)` / `setTimeout(..., 50)`) before immediately evaluating synchronous `expect(screen.lastFrame())` assertions.
- Under heavy load (e.g. 64 vitest workers running concurrently), React state updates and Ink frame re-renders are delayed across event loop turns, causing assertions to read stale frames before input was processed (e.g. empty query `⌕ Search…` instead of `beta`).
- `src/ui/SessionPicker.tsx` is not at fault.

### Changes
- In `tests/sessionPicker.test.tsx:32-120`, replaced synchronous frame and mock assertions with `await vi.waitFor(() => { ... })` across the interactive tests (typing filter & cancel, repo switch / rename / preview, and deletion confirmation), matching the synchronization pattern in `tests/themePicker.test.tsx`.

### Verification Results
1. **Isolated test file** (`tests/sessionPicker.test.tsx`): 10 / 10 runs passed.
2. **Full test suite** (`npm test`): 2 / 2 consecutive runs passed (64 test files, 484 tests).