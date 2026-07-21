import bcrypt
import secrets
from datetime import datetime, timedelta
from sqlalchemy.future import select
from .models import User, Session
from .database import AsyncSessionLocal

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))
    except Exception:
        return False

def get_password_hash(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

async def create_session(user_id: int):
    token = secrets.token_hex(32)
    expires = datetime.utcnow() + timedelta(days=7)
    
    async with AsyncSessionLocal() as db:
        new_session = Session(id=token, user_id=user_id, expires_at=expires)
        db.add(new_session)
        await db.commit()
        
    return token

async def get_user_by_session(token: str):
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(User).join(Session).where(Session.id == token, Session.expires_at > datetime.utcnow())
        )
        return result.scalars().first()

async def delete_session(token: str):
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Session).where(Session.id == token))
        session = result.scalars().first()
        if session:
            await db.delete(session)
            await db.commit()
