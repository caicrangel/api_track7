SHELL := /bin/bash

.PHONY: help setup up down restart logs ps build rebuild migrate seed sync psql clean

help: ## Lista os comandos disponíveis
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[32m%-12s\033[0m %s\n", $$1, $$2}'

setup: ## Cria o .env a partir do exemplo e gera segredos
	@test -f .env || cp .env.example .env
	@./scripts/gen-secrets.sh

up: ## Sobe toda a stack
	docker compose up -d --build

down: ## Derruba a stack
	docker compose down

restart: ## Reinicia api, worker e web
	docker compose restart api worker web

build: ## Build das imagens
	docker compose build

rebuild: ## Build sem cache
	docker compose build --no-cache

logs: ## Logs em tempo real
	docker compose logs -f --tail=100

ps: ## Status dos containers
	docker compose ps

migrate: ## Roda as migrações
	docker compose exec api node dist/db/migrate.js

sync: ## Dispara uma sincronização Track7 manual
	docker compose exec api node dist/cli/sync.js

psql: ## Abre um psql no banco
	docker compose exec postgres psql -U $${POSTGRES_USER:-fleetgov} -d $${POSTGRES_DB:-fleetgov}

clean: ## Remove containers e volumes (APAGA O BANCO)
	docker compose down -v
