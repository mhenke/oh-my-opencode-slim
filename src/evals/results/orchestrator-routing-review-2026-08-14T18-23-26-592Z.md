```json
{
  "reviews": [
    {
      "evalId": "trivial-edit-direct",
      "diagnosis": "The orchestrator produced completely empty output. The task (adding a one-line comment) is trivial and should be handled directly per the delegation rules. The assertion checking for '// This file' is reasonable. The agent failed to produce any response at all.",
      "grade": 1,
      "recommendation": "fix_agent",
      "details": "Empty output indicates the orchestrator is not generating any response. This is a systemic failure, not a delegation logic error."
    },
    {
      "evalId": "multi-file-to-fixer",
      "diagnosis": "The orchestrator produced completely empty output. The task (refactoring error handling across multiple files) correctly requires delegation to @fixer per the mandatory delegation rules. The assertion checking for '@fixer' is appropriate. The agent failed to produce any response.",
      "grade": 1,
      "recommendation": "fix_agent",
      "details": "Empty output. The orchestrator should have recognized this as multi-file implementation work and delegated to @fixer."
    },
    {
      "evalId": "architecture-to-oracle",
      "diagnosis": "The orchestrator produced completely empty output. The task (architecture tradeoffs for storage backend) correctly requires delegation to @oracle per the delegation rules. The assertion checking for '@oracle' is appropriate. The agent failed to produce any response.",
      "grade": 1,
      "recommendation": "fix_agent",
      "details": "Empty output. The orchestrator should have recognized this as an architecture decision and delegated to @oracle."
    },
    {
      "evalId": "external-docs-to-librarian",
      "diagnosis": "The orchestrator produced completely empty output. The task (looking up SDK documentation) correctly requires delegation to @librarian per the delegation rules. The assertion checking for '@librarian' is appropriate. The agent failed to produce any response.",
      "grade": 1,
      "recommendation": "fix_agent",
      "details": "Empty output. The orchestrator should have recognized this as external research and delegated to @librarian."
    },
    {
      "evalId": "codebase-search-to-explorer",
      "diagnosis": "The orchestrator produced completely empty output. The task (finding all emitEvent call sites) correctly requires delegation to @explorer per the delegation rules. The assertion checking for '@explorer' is appropriate. The agent failed to produce any response.",
      "grade": 1,
      "recommendation": "fix_agent",
      "details": "Empty output. The orchestrator should have recognized this as codebase search and delegated to @explorer."
    },
    {
      "evalId": "trivial-should-handle-direct",
      "diagnosis": "The orchestrator produced completely empty output. The task (listing npm scripts from package.json) is trivial and should be handled directly. The assertion checking for 'scripts' is reasonable. The agent failed to produce any response.",
      "grade": 1,
      "recommendation": "fix_agent",
      "details": "Empty output. The orchestrator should have read package.json and listed the scripts directly."
    },
    {
      "evalId": "reflect-progressive-disclosure",
      "diagnosis": "The orchestrator produced completely empty output. The task (analyzing recent sessions for reusable commands) should trigger the reflect skill, which requires reading the skill reference file. The assertion checking for reference content is appropriate. The agent failed to produce any response.",
      "grade": 1,
      "recommendation": "fix_agent",
      "details": "Empty output. The orchestrator should have invoked the reflect skill and read its reference file before responding."
    },
    {
      "evalId": "clonedeps-progressive-disclosure",
      "diagnosis": "The orchestrator produced completely empty output. The task (cloning SDK source for inspection) should trigger the clonedeps skill, which requires reading the skill reference file. The assertion checking for reference content is appropriate. The agent failed to produce any response.",
      "grade": 1,
      "recommendation": "fix_agent",
      "details": "Empty output. The orchestrator should have invoked the clonedeps skill and read its reference file before responding."
    },
    {
      "evalId": "verification-planning-progressive-disclosure",
      "diagnosis": "The orchestrator produced completely empty output. The task (planning verification for a refactor) should trigger the verification-planning skill, which requires reading the skill reference file. The assertion checking for reference content is appropriate. The agent failed to produce any response.",
      "grade": 1,
      "recommendation": "fix_agent",
      "details": "Empty output. The orchestrator should have invoked the verification-planning skill and read its reference file before responding."
    },
    {
      "evalId": "deepwork-progressive-disclosure",
      "diagnosis": "The orchestrator produced completely empty output. The task (managing ESM migration as phased effort) should trigger the deepwork skill, which requires reading the skill reference file. The assertion checking for reference content is appropriate. The agent failed to produce any response.",
      "grade": 1,
      "recommendation": "fix_agent",
      "details": "Empty output. The orchestrator should have invoked the deepwork skill and read its reference file before responding."
    },
    {
      "evalId": "ui-work-to-designer",
      "diagnosis": "The orchestrator produced completely empty output. The task (designing a dark mode toggle) correctly requires delegation to @designer per the delegation rules. The assertion checking for '@designer' is appropriate. The agent failed to produce any response.",
      "grade": 1,
      "recommendation": "fix_agent",
      "details": "Empty output. The orchestrator should have recognized this as UI/UX work and delegated to @designer."
    }
  ],
  "summary": "CRITICAL SYSTEMIC FAILURE: The orchestrator agent produced completely empty output across ALL 11 evals (100% failure rate). This is not a delegation logic problem — the agent is not generating any response whatsoever. The evals themselves are well-designed and test valid behaviors: trivial tasks should be handled directly, multi-file/architecture/research/codebase/UI tasks should be delegated to the appropriate specialist (@fixer, @oracle, @librarian, @explorer, @designer), and progressive disclosure tasks should trigger the relevant skill and read its reference file. The root cause is almost certainly a configuration, prompt, or runtime issue with the orchestrator agent itself that prevents it from producing any output. Immediate investigation into the orchestrator's prompt configuration, skill invocation setup, and runtime behavior is required before any delegation logic can be evaluated."
}
```