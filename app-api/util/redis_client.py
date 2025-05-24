import redis.asyncio as redis
import json
import hashlib
import functools
import inspect
import logging # Add logging

from util.config import config # Adjusted import path

logger = logging.getLogger(__name__) # Setup logger

_redis_pool = None

async def init_redis_pool():
    global _redis_pool
    if _redis_pool is None:
        redis_config = config("redis")
        if redis_config and redis_config.get("host"): # Check if host is configured
            try:
                _redis_pool = redis.ConnectionPool(
                    host=redis_config.get("host"),
                    port=redis_config.get("port", 6379),
                    db=redis_config.get("db", 0),
                    password=redis_config.get("password"),
                    decode_responses=False # Important for json.loads(bytes)
                )
                # Try a PING to ensure connection is okay on startup
                r = await get_redis_connection()
                if r:
                    await r.ping()
                    logger.info("Redis connection pool initialized and PING successful.")
                    await r.close() # Release the connection used for ping
                else: # Should not happen if pool was created, but as a safeguard
                    _redis_pool = None # Invalidate pool if ping failed via a null connection
                    logger.error("Failed to get Redis connection for initial PING.")
            except redis.RedisError as e:
                _redis_pool = None # Ensure pool is None if init fails
                logger.error(f"Redis connection failed during init: {e}")
            except Exception as e: # Catch any other unexpected errors during init
                _redis_pool = None
                logger.error(f"An unexpected error occurred during Redis initialization: {e}")
        else:
            logger.warning("Redis configuration not found or host not specified. Redis client will not be available.")

async def get_redis_connection():
    if _redis_pool is None:
        # init_redis_pool should have been called at startup.
        # If it's still None, Redis is not available.
        return None
    return redis.Redis(connection_pool=_redis_pool)

def _generate_cache_key(func_name: str, args: tuple, kwargs: dict) -> str:
    # Stable serialization for args and kwargs
    # Sort kwargs by key to ensure consistent ordering
    # Use repr for args and items to get a more stable string representation for basic types
    # json.dumps is safer for complex nested structures
    try:
        # Attempt to serialize using JSON with a robust default for unslizable objects
        payload = (args, sorted(kwargs.items()))
        serialized_args = json.dumps(payload, sort_keys=True, default=str)
    except TypeError:
        # Fallback for very complex objects, though this might lead to less precise caching
        # or potential collisions if str representations are not unique.
        serialized_args = str(payload)

    # Using SHA256 for robustness
    return f"cache:{func_name}:{hashlib.sha256(serialized_args.encode('utf-8')).hexdigest()}"

async def set_cache_direct(key: str, value: any, ttl: int): # Direct version for when key is pre-generated
    r = await get_redis_connection()
    if not r:
        logger.warning("Redis unavailable, skipping set_cache.")
        return
    try:
        serialized_value = json.dumps(value)
        await r.setex(key, ttl, serialized_value.encode('utf-8')) # Encode to bytes
    except redis.RedisError as e:
        logger.error(f"Redis setex failed for key {key}: {e}")
    except TypeError as e: # Catch JSON serialization errors
        logger.error(f"JSON serialization failed for key {key}: {e}")
    finally:
        if r:
            await r.close()

async def get_cache_direct(key: str): # Direct version
    r = await get_redis_connection()
    if not r:
        logger.warning("Redis unavailable, skipping get_cache.")
        return None
    try:
        cached_value_bytes = await r.get(key)
        if cached_value_bytes:
            return json.loads(cached_value_bytes.decode('utf-8')) # Decode from bytes then JSON loads
        return None
    except redis.RedisError as e:
        logger.error(f"Redis get failed for key {key}: {e}")
        return None
    except json.JSONDecodeError as e: # Catch JSON deserialization errors
        logger.error(f"JSON deserialization failed for key {key}: {e}")
        return None
    finally:
        if r:
            await r.close()

async def delete_cache_direct(key: str): # Direct version
    r = await get_redis_connection()
    if not r:
        logger.warning("Redis unavailable, skipping delete_cache.")
        return
    try:
        await r.delete(key)
    except redis.RedisError as e:
        logger.error(f"Redis delete failed for key {key}: {e}")
    finally:
        if r:
            await r.close()

# Decorator
def cache_redis(ttl: int = 3600):
    def decorator(func):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            if _redis_pool is None: # Check if Redis is available
                logger.warning("Redis unavailable, calling original function without caching.")
                if inspect.iscoroutinefunction(func):
                    return await func(*args, **kwargs)
                else: # Should not happen if we primarily cache async FastAPI route handlers
                    return func(*args, **kwargs)

            # Pass actual args/kwargs to _generate_cache_key
            key = _generate_cache_key(func.__name__, args, kwargs)
            
            cached_result = await get_cache_direct(key)
            if cached_result is not None:
                logger.debug(f"Cache hit for key {key}")
                return cached_result
            
            logger.debug(f"Cache miss for key {key}")
            if inspect.iscoroutinefunction(func):
                result = await func(*args, **kwargs)
            else:
                result = func(*args, **kwargs) # For any synchronous functions
            
            await set_cache_direct(key, result, ttl)
            return result
        return wrapper
    return decorator
