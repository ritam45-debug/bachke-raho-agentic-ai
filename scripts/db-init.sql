-- Local docker only. Two roles: the owner runs migrations; the API runs as a non-owner so Row-Level Security applies.
CREATE ROLE owner_role LOGIN PASSWORD 'devonly-owner';
CREATE ROLE bachke_app LOGIN PASSWORD 'devonly-app';
CREATE DATABASE bachke OWNER owner_role;
\connect bachke
GRANT USAGE ON SCHEMA public TO bachke_app;
ALTER DEFAULT PRIVILEGES FOR ROLE owner_role IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bachke_app;
