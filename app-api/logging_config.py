# Configuration for logging in the application

import logging
import sys

# Configure logging once
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(name)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)


def get_logger(name: str):
    """Returns a logger instance with the given name"""
    return logging.getLogger(name)
