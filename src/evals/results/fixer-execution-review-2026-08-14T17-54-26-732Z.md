```json
{
  "reviews": [
    {
      "evalId": "no-research",
      "diagnosis": "The agent produced completely empty output (only whitespace). No validateEmail function was written, no summary/changes sections were generated. The task is clear and unambiguous — add a regex-based email validator to a specific file. The failure is not in the eval assertion but in the agent itself producing zero output.",
      "grade": 1,
      "recommendation": "fix_agent",
      "details": "The fixer agent is not producing any output at all. This is a systemic failure — the agent appears to be crashing, timing out silently, or not being invoked correctly. The eval assertions are reasonable: checking for the function name, the regex pattern, and structural sections. All fail because there is no output to check."
    },
    {
      "evalId": "output-format",
      "diagnosis": "The agent produced completely empty output (only whitespace). No helloWorld function was written, and none of the required structural sections (<summary>, <changes>, <verification>) were present. The task is straightforward and the output format requirements are explicit in the prompt.",
      "grade": 1,
      "recommendation": "fix_agent",
      "details": "Same root cause as no-research: the fixer agent is producing zero output. The eval is testing both code generation and output formatting, both of which are reasonable expectations. The agent's empty output means it failed at the most basic level — producing any response at all."
    },
    {
      "evalId": "edge-case-handling",
      "diagnosis": "The agent produced completely empty output (only whitespace). No safeParseJson function was written, no null-return handling, no summary section. The task is clear: implement graceful JSON parsing with null fallback. The assertion checking for 'return null' is reasonable for the described behavior.",
      "grade": 1,
      "recommendation": "fix_agent",
      "details": "Identical symptom to the other three evals. The fixer agent is producing no output whatsoever. The eval assertions are appropriate for the task — checking for the function name, the null-return behavior, and structural sections. All fail due to empty agent output."
    },
    {
      "evalId": "code-quality",
      "diagnosis": "The agent produced completely empty output (only whitespace). No formatCurrency function was written, no currency formatting logic, no summary section. The task is clear and the expected output format ($1,234.56) is well-specified.",
      "grade": 1,
      "recommendation": "fix_agent",
      "details": "Same systemic failure. The fixer agent is producing zero output across all four evals. The eval assertions are reasonable — checking for the function name, the currency regex pattern, and structural sections. The agent's empty output is the root cause of all failures."
    }
  ],
  "summary": "All four evals show the same critical symptom: the fixer agent produces completely empty output (whitespace only) in every case. This is not a problem with the eval assertions or task ambiguity — the tasks are clear, well-scoped, and the assertions are appropriate. The root cause is a systemic failure in the fixer agent itself: it is not generating any response at all. This could be due to the agent crashing, timing out silently, or a configuration/invocation issue. The fixer agent needs to be diagnosed and repaired before any eval results can be trusted. Once the agent produces non-empty output, the evals should be re-run to determine whether the agent's actual code quality and output formatting meet the assertions."
}
```