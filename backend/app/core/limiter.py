from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


def _get_user_or_ip(request: Request) -> str:
    user = getattr(request.state, "user", None)
    if user and hasattr(user, "id"):
        return str(user.id)
    return get_remote_address(request)


# In-memory storage, which is correct only at a single replica: counters live in
# the process, so they reset on deploy and are not shared between instances.
# Scaling past one replica silently weakens every limit here — see
# docs/rate-limiting-plan.md for the Redis storage_uri swap that fixes it.
limiter = Limiter(key_func=_get_user_or_ip)
