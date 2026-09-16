# Referência de contrato

`mix-integrate-swagger-v1.json` — especificação Swagger 2.0 da API oficial
(`MiX.Integrate.Api` v1, host `integrate.us.mixtelematics.com`), obtida do portal de
documentação da Track7. É a fonte de verdade do contrato: rotas, parâmetros e schemas.

Use para conferir qualquer endpoint antes de implementar:

```bash
# listar as rotas de um controller
python3 -c "import json;d=json.load(open('docs/reference/mix-integrate-swagger-v1.json'));[print(m.upper(),p) for p,o in d['paths'].items() if 'fueltransactions' in p for m in o]"

# ver os campos de um schema
python3 -c "import json;d=json.load(open('docs/reference/mix-integrate-swagger-v1.json'));[print(k,':',v.get('type') or v.get('\$ref')) for k,v in d['definitions']['Asset']['properties'].items()]"
```
