from app.core.security import create_access_token, hash_password
from app.db.session import AsyncSessionLocal
from app.models.user import User


async def make_user(email: str = "u@example.com") -> User:
    async with AsyncSessionLocal() as db:
        user = User(email=email, hashed_password=hash_password("pw"))
        db.add(user)
        await db.commit()
        return user


def auth(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(str(user.id))}"}
