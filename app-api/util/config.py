import os

import yaml


def config(key: str):
    """
    Reads the config file and returns the value of the key.

    Reads values from the explorer.config.yml file.

    Args:
        key (str): The key to read from the config file.
    Returns:
        The value of the key in the config file (str, int, list, dict depending on the config file).
    """
    config_file = os.getenv("CONFIG_FILE", "explorer.config.yml")
    with open(config_file) as f:
        config_obj = yaml.safe_load(f)
        # If the key is in the top-level of the config_obj, return the entire section.
        # Otherwise, behave as before.
        if key in config_obj:
            return config_obj[key]
        return config_obj.get(key)
