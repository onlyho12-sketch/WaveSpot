-- WaveSpot DB 스키마 (SQLite) · backend/app/models.py 에서 자동 생성, 직접 고치지 말 것
-- 다시 만들기: backend 폴더에서  .venv/Scripts/python -m app.core.dump_schema

CREATE TABLE accesslog (
	id INTEGER NOT NULL, 
	session_id INTEGER, 
	at DATETIME NOT NULL, 
	role VARCHAR NOT NULL, 
	method VARCHAR NOT NULL, 
	path VARCHAR NOT NULL, 
	action VARCHAR NOT NULL, 
	status INTEGER NOT NULL, 
	allowed BOOLEAN NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE agentevent (
	id INTEGER NOT NULL, 
	session_id INTEGER NOT NULL, 
	sim_time FLOAT NOT NULL, 
	device_id VARCHAR, 
	stage VARCHAR NOT NULL, 
	level VARCHAR NOT NULL, 
	message VARCHAR NOT NULL, 
	data JSON, 
	PRIMARY KEY (id)
);

CREATE TABLE alloweddevice (
	id INTEGER NOT NULL, 
	session_id INTEGER NOT NULL, 
	device_id VARCHAR NOT NULL, 
	label VARCHAR NOT NULL, 
	reason VARCHAR NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE attackrun (
	id INTEGER NOT NULL, 
	session_id INTEGER NOT NULL, 
	kind VARCHAR NOT NULL, 
	title VARCHAR NOT NULL, 
	injected BOOLEAN NOT NULL, 
	started FLOAT NOT NULL, 
	detected_at FLOAT, 
	detail VARCHAR, 
	device_id VARCHAR, 
	PRIMARY KEY (id)
);

CREATE TABLE chainentry (
	id INTEGER NOT NULL, 
	session_id INTEGER NOT NULL, 
	seq INTEGER NOT NULL, 
	kind VARCHAR NOT NULL, 
	ref_id INTEGER NOT NULL, 
	body JSON, 
	body_hash VARCHAR NOT NULL, 
	prev_hash VARCHAR NOT NULL, 
	hash VARCHAR NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE examsession (
	id INTEGER NOT NULL, 
	name VARCHAR NOT NULL, 
	rows INTEGER NOT NULL, 
	cols INTEGER NOT NULL, 
	state VARCHAR NOT NULL, 
	scenario VARCHAR NOT NULL, 
	exam_start_label VARCHAR NOT NULL, 
	duration_min INTEGER NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE faultrecord (
	id INTEGER NOT NULL, 
	session_id INTEGER NOT NULL, 
	kind VARCHAR NOT NULL, 
	title VARCHAR NOT NULL, 
	action VARCHAR NOT NULL, 
	started FLOAT NOT NULL, 
	ended FLOAT, 
	target_sec FLOAT, 
	missed INTEGER NOT NULL, 
	recover_sec FLOAT, 
	injected BOOLEAN NOT NULL, 
	PRIMARY KEY (id)
);

CREATE TABLE searchrequest (
	id INTEGER NOT NULL, 
	session_id INTEGER NOT NULL, 
	device_id VARCHAR NOT NULL, 
	level INTEGER NOT NULL, 
	zone INTEGER NOT NULL, 
	zone_prob FLOAT NOT NULL, 
	zone2 INTEGER, 
	zone2_prob FLOAT, 
	seats JSON, 
	score INTEGER NOT NULL, 
	kind VARCHAR NOT NULL, 
	state VARCHAR NOT NULL, 
	evidence JSON, 
	counter JSON, 
	search_parts JSON, 
	suspect_seat INTEGER, 
	walk JSON, 
	sim_time FLOAT NOT NULL, 
	created_at DATETIME NOT NULL, 
	resolved_at DATETIME, 
	found_seat INTEGER, 
	note VARCHAR, 
	PRIMARY KEY (id)
);

CREATE TABLE supervisornote (
	id INTEGER NOT NULL, 
	session_id INTEGER NOT NULL, 
	sim_time FLOAT NOT NULL, 
	text VARCHAR NOT NULL, 
	created_at DATETIME NOT NULL, 
	PRIMARY KEY (id)
);
