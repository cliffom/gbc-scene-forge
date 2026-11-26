"""Backend errors; adapters preserve their existing public error contracts."""


class InvalidRequest(ValueError):
    """Input violates a native authoring or storage constraint."""


class Conflict(ValueError):
    """Saved state no longer matches the caller's expected revision."""


class TransactionBusy(ValueError):
    """A cooperating writer already owns the nonblocking filesystem lock."""
