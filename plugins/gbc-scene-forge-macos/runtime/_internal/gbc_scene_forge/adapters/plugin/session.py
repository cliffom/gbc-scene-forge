"""Bootstrap MCP tools: native user grants precede all project access."""

from pathlib import Path

from gbc_scene_forge.adapters.mcp.tools import TOOLS, Adapter, validate_arguments
from gbc_scene_forge.core.validation import require
from gbc_scene_forge.project.workspaces import slug

from .browser import BrowserManager
from .distribution import InstallationGuard
from .selection import WORKSPACE_LIBRARY, choose_directory

BROWSER_TOOL = {
    "name": "plugin_browser",
    "description": "Get a verified loopback browser URL for this project's saved content, or inspect "
    "its shared browser process. Open the returned URL with the client's browser tool. "
    "Optional scene_id opens a saved scene. Artwork opens through Documents. "
    "Use stop only on an explicit user request, with the current instance from status; "
    "it affects all tabs/conversations sharing that browser. Never stop on chat closure.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "project": {"type": "string"},
            "action": {"type": "string", "enum": ["open", "status", "stop"]},
            "scene_id": {"type": "string"},
            "instance": {"type": "string"},
        },
        "required": ["project", "action"],
        "additionalProperties": False,
    },
}

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
            "Open a native folder chooser. Use workspace for the game folder containing "
            ".gbc-scene-forge/, or project to open an existing Forge project directly. "
            "Root selects a legacy library directly. Cancellation preserves the selection. "
            "Explain the scope and ask the user to finish or cancel the dialog.",
            {
                "mode": {"type": "string", "enum": ["workspace", "project", "root"]},
                "start_in": {
                    "type": "string",
                    "description": "Optional absolute working folder from chat context. "
                    "Only a picker hint; grants no project access.",
                },
            },
            ["mode"],
        ),
        (
            "plugin_reset_selection",
            "Forget this session's selection or an inherited legacy selection. "
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
        "list_artwork_candidates",
        "export_artwork_candidate",
        "release_artwork_candidate",
        "review_artwork_candidate",
        "inspect_artwork_candidate",
        "review_artwork_animation",
        "commit_artwork",
        "create_scene",
        "create_blockout_scene",
        "review_blockout",
        "get_scene",
        "save_scene",
        "edit_scene",
        "review_artwork",
        "import_atlas",
        "export_bundle",
    }
)


class PluginSession:
    tool_definitions = (
        SETUP_TOOLS + [BROWSER_TOOL] + [t for t in TOOLS if t["name"] in AUTHORING_NAMES]
    )

    def __init__(self, selection, *, chooser=choose_directory):
        self.selection = selection
        self.installation_guard = InstallationGuard(selection.bundle)
        self.installation = self.installation_guard.identity
        self.chooser = chooser
        self.browser = BrowserManager(selection)
        self.record = None
        self.workspace = None
        self.adapter = None
        self.error = None
        self.inherited = True
        try:
            record = selection.load()
            if record:
                self.adapter = self.open(record)
                self.record = record
        except (ValueError, OSError, KeyError, TypeError, RecursionError) as error:
            self.error = str(error)

    def open(self, record):
        path = self.selection.validate(record)
        return Adapter(
            path, single_project=record["mode"] == "project", recover=False, create_root=False
        )

    def revalidate(self):
        self.installation_guard.check()
        if self.record is None and self.workspace is None:
            return
        try:
            if self.inherited:
                require(
                    self.selection.load() == self.record,
                    "Legacy selection changed. Choose a location again to reconnect.",
                )
            elif self.workspace and self.record is None:
                record = self.selection.library(self.workspace)
                if record:
                    self.adapter, self.record = self.open(record), record
            else:
                if self.workspace:
                    self.selection.validate(self.workspace)
                self.selection.validate(self.record)
        except (ValueError, OSError, KeyError, TypeError, RecursionError) as error:
            self.record = None
            self.workspace = None
            self.adapter = None
            self.error = str(error)

    def plugin_capabilities(self):
        return {
            **Adapter.capabilities(),
            "tools": [tool["name"] for tool in self.tool_definitions],
            "tool_profile": "plugin",
            "unavailable_tools": [t["name"] for t in TOOLS if t["name"] not in AUTHORING_NAMES],
            "full_inventory": "Use browser editing or direct --project/--project-root MCP.",
        }

    def library_path(self):
        return str(Path(self.workspace["path"]) / WORKSPACE_LIBRARY)

    @property
    def artifacts(self):
        self.revalidate()
        return self.adapter.artifacts if self.adapter else {}

    def read_artifact(self, uri):
        self.revalidate()
        require(
            self.adapter is not None,
            "Unknown or expired session artifact. Choose a project location and generate it again.",
        )
        return self.adapter.read_artifact(uri)

    def status(self):
        self.revalidate()
        record = self.record
        if self.workspace:
            record = {
                "mode": "workspace",
                "path": self.library_path(),
                "game_folder": self.workspace["path"],
                "library_exists": self.record is not None,
            }
        return {
            "installation": self.installation,
            "selection": record,
            "selection_scope": ("legacy" if self.inherited else "chat") if record else None,
            "settings_file": str(self.selection.settings),
            "cache_directory": str(self.selection.cache),
            "error": self.error,
            "next_step": "Use this project, draw a small sprite, build a scene, or explore. "
            "Skip the introduction when the user has a task."
            if record
            else "Choose the game folder (workspace) or open an existing Forge project (project). "
            "Workspace projects live under .gbc-scene-forge/; discovery creates nothing.",
            "project_alias": "project"
            if self.record and self.record["mode"] == "project"
            else None,
        }

    def choose_location(self, arguments):
        mode = arguments.get("mode")
        start_in = arguments.get("start_in", "")
        require(
            arguments.keys() <= {"mode", "start_in"}
            and mode in ("workspace", "project", "root")
            and isinstance(start_in, str)
            and len(start_in) <= 4096,
            "Choose workspace, project or root with an optional picker starting folder",
        )
        path = self.chooser(mode, start_in=start_in) if start_in else self.chooser(mode)
        if path is None:
            return {**self.status(), "cancelled": True}
        chosen = self.selection.prepare(path, mode)
        workspace = chosen if mode == "workspace" else None
        record = self.selection.library(workspace) if workspace else chosen
        adapter = self.open(record) if record else None
        self.installation_guard.check()
        self.inherited = False
        self.workspace = workspace
        self.record, self.adapter, self.error = record, adapter, None
        return self.status()

    def create_library(self, arguments):
        validate_arguments("create_project", arguments)
        require(arguments.get("starter", "empty") in ("empty", "blockout"), "Invalid starter")
        slug(arguments["name"])
        record = self.selection.library(self.workspace, create=True)
        require(record is not None, "The Forge library could not be created; choose again")
        self.adapter, self.record = self.open(record), record

    def call(self, name, arguments):
        self.installation_guard.check()
        if name in {tool["name"] for tool in SETUP_TOOLS}:
            require(isinstance(arguments, dict), "Invalid setup tool arguments")
            if name == "plugin_choose_location":
                return self.choose_location(arguments)
            require(not arguments, "This setup tool takes no arguments")
            if name == "plugin_reset_selection":
                if self.inherited:
                    self.selection.reset()
                self.inherited = False
                self.workspace = None
                self.record, self.adapter, self.error = None, None, None
            return self.status()
        require(
            name in AUTHORING_NAMES or name == "plugin_browser",
            "This tool is unavailable in the bounded plugin profile. "
            "Use browser editing or direct --project/--project-root MCP for the full inventory.",
        )
        self.revalidate()
        if self.workspace and self.record is None:
            if name == "list_projects":
                require(arguments == {}, "Invalid tool arguments")
                return {
                    "project": None,
                    "projects": [],
                    "unavailable": [],
                    "project_root": self.library_path(),
                }
            if name == "capabilities":
                require(arguments == {}, "Invalid tool arguments")
                return self.plugin_capabilities()
            require(name == "create_project", "Create a project in the selected game folder first")
            self.create_library(arguments)
        require(
            self.adapter is not None,
            "No available project grant. Call plugin_status, then plugin_choose_location. "
            + (self.error or "No location selected."),
        )
        if name == "plugin_browser":
            require(
                isinstance(arguments, dict)
                and {"project", "action"} <= arguments.keys()
                and arguments.keys() <= BROWSER_TOOL["inputSchema"]["properties"].keys()
                and all(isinstance(value, str) for value in arguments.values()),
                "Invalid browser handoff arguments",
            )
            return self.browser.request(
                self.adapter.project(arguments["project"]),
                action=arguments["action"],
                scene_id=arguments.get("scene_id"),
                instance=arguments.get("instance"),
            )
        if name == "list_projects" and self.record["mode"] == "project":
            require(arguments == {}, "Invalid tool arguments")
            # Match root discovery: do not acquire a writable history lock or
            # recover a journal merely to identify a selected project.
            project, _ = self.adapter.single.read()
            return {
                "projects": [{"directory": "project", "id": project["id"], "name": project["name"]}]
            }
        if name == "capabilities":
            require(arguments == {}, "Invalid tool arguments")
            return self.plugin_capabilities()
        return self.adapter.call(name, arguments)
