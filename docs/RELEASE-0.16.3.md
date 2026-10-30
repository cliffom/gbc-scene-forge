# Scene Forge 0.16.3

Project chooser cards now show a complete rounded highlight on hover and keyboard
focus, including the edges of a scrolling list. The inset outline preserves card
size, spacing and navigation.

All browser acceptance suites now use Playwright Test with shared temporary
workspace/server fixtures, native locator interactions, failure screenshots,
traces and logs. Each invocation retains its own reports. The custom CDP harness
has been removed; Playwright remains a development dependency.

Existing projects and portable formats are unchanged. Python installations still
need neither Node nor browser test tooling. This patch release is prepared for
the visible chooser fix; the test migration alone would not require a release.
