"""Bootstrap MCP tools: native user grants precede all project access."""

from gbc_scene_forge.adapters.mcp.tools import TOOLS, Adapter
from gbc_scene_forge.core.validation import require

from .selection import choose_directory

SETUP_TOOLS = [
    {
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": False,
        },
    }
    for name, description, properties, required in (
        (
            "plugin_status",
            "Show effective project/root, settings location and setup errors. Read-only.",
            {},
            [],
        ),
        (
            "plugin_choose_location",
            "Open a native user folder chooser to reopen one project or select a parent root "
            "for discovery/creation. Cancellation preserves the current selection. "
            "Explain the scope and ask the user to finish or cancel the dialog.",
            {"mode": {"type": "string", "enum": ["project", "root"]}},
            ["mode"],
        ),
        (
            "plugin_reset_selection",
            "Forget the saved selection and revoke this session's access. "
            "Does not delete projects, saved content, candidates or browser drafts.",
            {},
            [],
        ),
    )
]

# The demonstrated Codex client exposes only 32 tools per server to model turns.
# Keep setup and the complete first-task flow together in a fixed bounded profile;
# SDK tools/list alone cannot establish that the model can call every tool.
AUTHORING_NAMES = frozenset(
    {
        "capabilities",
        "list_projects",
        "create_project",
        "get_project",
        "list_artwork",
        "open_artwork",
        "create_artwork",
        "create_artwork_sheet",
        "edit_artwork_pixels",
        "edit_artwork_layers",
        "edit_artwork_layout",
        "read_artwork_pixels",
        "review_artwork_candidate",
        "inspect_artwork_candidate",
        "review_artwork_animation",
        "review_artwork_frame",
        "commit_artwork",
        "create_scene",
        "create_blockout_scene",
        "review_blockout",
        "get_scene",
        "save_scene",
        "edit_scene",
        "review_artwork",
        "review_scene",
        "import_atlas",
        "place_stamp",
        "save_stamp",
        "export_bundle",
    }
)


class PluginSession:
    tool_definitions = SETUP_TOOLS + [t for t in TOOLS if t["name"] in AUTHORING_NAMES]

    def __init__(self, selection, *, chooser=choose_directory):
        self.selection = selection
        self.chooser = chooser
        self.record = None
        self.adapter = None
        self.error = None
        try:
            record = selection.load()
            if record:
                self.adapter = self.open(record)
                self.record = record
        except (ValueError, OSError, KeyError, TypeError, RecursionError) as error:
            self.error = str(error)

    def open(self, record):
        path = self.selection.validate(record)
        return Adapter(path, single_project=record["mode"] == "project", recover=False)

    def revalidate(self):
        if self.record is None:
            return
        try:
            require(
                self.selection.load() == self.record,
                "Selection changed in another conversation. Choose a location again to reconnect.",
            )
        except (ValueError, OSError, KeyError, TypeError, RecursionError) as error:
            self.record = None
            self.adapter = None
            self.error = str(error)

    @property
    def artifacts(self):
        self.revalidate()
        return self.adapter.artifacts if self.adapter else {}

    def read_artifact(self, uri):
        self.revalidate()
        require(
            self.adapter is not None, "Choose a project location first using plugin_choose_location"
        )
        return self.adapter.read_artifact(uri)

    def status(self):
        self.revalidate()
        return {
            "selection": self.record,
            "settings_file": str(self.selection.settings),
            "cache_directory": str(self.selection.cache),
            "error": self.error,
            "next_step": "Use this project, draw a small sprite, build a scene, or explore. "
            "Skip the introduction when the user has a task."
            if self.record
            else "Choose an existing project (project), or a parent folder (root) to create one. "
            "plugin_choose_location opens the native dialog; project discovery creates nothing.",
            "project_alias": "project"
            if self.record and self.record["mode"] == "project"
            else None,
        }

    def call(self, name, arguments):
        if name in {tool["name"] for tool in SETUP_TOOLS}:
            require(isinstance(arguments, dict), "Invalid setup tool arguments")
            if name == "plugin_choose_location":
                require(
                    set(arguments) == {"mode"} and arguments["mode"] in ("project", "root"),
                    "Choose project or root; paths are granted only through the native dialog",
                )
                path = self.chooser(arguments["mode"])
                if path is None:
                    return {**self.status(), "cancelled": True}
                record = self.selection.prepare(path, arguments["mode"])
                adapter = self.open(record)
                self.selection.save(record)  # Failed selection/persistence preserves old access.
                self.record, self.adapter, self.error = record, adapter, None
                return self.status()
            require(not arguments, "This setup tool takes no arguments")
            if name == "plugin_reset_selection":
                self.selection.reset()
                self.record, self.adapter, self.error = None, None, None
            return self.status()
        require(
            name in AUTHORING_NAMES,
            "This tool is unavailable in the bounded plugin profile. "
            "Use browser editing or direct --project/--project-root MCP for the full inventory.",
        )
        self.revalidate()
        require(
            self.adapter is not None,
            "No available project grant. Call plugin_status, then plugin_choose_location. "
            + (self.error or "No location selected."),
        )
        if name == "list_projects" and self.record["mode"] == "project":
            require(arguments == {}, "Invalid tool arguments")
            # Match root discovery: do not acquire a writable history lock or
            # recover a journal merely to identify a selected project.
            project, _ = self.adapter.single.read()
            return {
                "projects": [{"directory": "project", "id": project["id"], "name": project["name"]}]
            }
        result = self.adapter.call(name, arguments)
        if name == "capabilities":
            result = {
                **result,
                "tools": [tool["name"] for tool in self.tool_definitions],
                "tool_profile": "plugin",
                "unavailable_tools": [t["name"] for t in TOOLS if t["name"] not in AUTHORING_NAMES],
                "full_inventory": "Use browser editing or direct --project/--project-root MCP.",
            }
        return result
