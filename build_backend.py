"""PEP 517/660 guard: never package absent or stale browser modules."""

from poetry.core.masonry import api as poetry_api

from tools.frontend_build import ensure

get_requires_for_build_wheel = poetry_api.get_requires_for_build_wheel
get_requires_for_build_sdist = poetry_api.get_requires_for_build_sdist
get_requires_for_build_editable = poetry_api.get_requires_for_build_editable
prepare_metadata_for_build_wheel = poetry_api.prepare_metadata_for_build_wheel
prepare_metadata_for_build_editable = poetry_api.prepare_metadata_for_build_editable


def build_wheel(wheel_directory, config_settings=None, metadata_directory=None):
    ensure()
    return poetry_api.build_wheel(wheel_directory, config_settings, metadata_directory)


def build_sdist(sdist_directory, config_settings=None):
    ensure()
    return poetry_api.build_sdist(sdist_directory, config_settings)


def build_editable(wheel_directory, config_settings=None, metadata_directory=None):
    ensure()
    return poetry_api.build_editable(wheel_directory, config_settings, metadata_directory)
