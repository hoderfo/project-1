from sqlalchemy import Column, Integer, String, Text, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from .database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)

    projects = relationship("Project", back_populates="owner")
    sessions = relationship("Session", back_populates="user")

class Session(Base):
    __tablename__ = "sessions"

    id = Column(String(100), primary_key=True, index=True) # The session token
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    expires_at = Column(DateTime, nullable=False)

    user = relationship("User", back_populates="sessions")

class Project(Base):
    __tablename__ = "projects"

    id = Column(String(50), primary_key=True, index=True) # Unique short ID for sharing
    name = Column(String(100), nullable=False)
    code = Column(Text, nullable=False, default="")
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True) # Null if anonymous

    owner = relationship("User", back_populates="projects")
