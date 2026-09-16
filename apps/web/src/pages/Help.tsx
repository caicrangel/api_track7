import { BookOpen, ExternalLink, KeyRound, Plug, RefreshCw, ShieldCheck, Truck } from 'lucide-react';
import { Card, PageHeader } from '../components/ui';

const SECTIONS = [
  {
    icon: <Plug className="h-5 w-5" />,
    title: 'Conectar à Track7',
    body: (
      <>
        <p>
          A Track7 opera sobre a plataforma <strong>MiX Telematics</strong> e a integração usa a API
          oficial <em>MiX Integrate</em>, com autenticação OpenID Connect (Resource Owner Password Flow).
          Você precisa de quatro dados, fornecidos pelo suporte da Track7:
        </p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><strong>Client ID</strong> e <strong>Client Secret</strong> — emitidos por solicitação (SR) ao suporte;</li>
          <li><strong>Usuário</strong> e <strong>Senha</strong> — as mesmas credenciais do MiX Fleet Manager;</li>
          <li>A <strong>região</strong> da conta (Américas, Europa, etc.), que define as URLs de identidade e da API.</li>
        </ul>
        <p className="mt-2">
          Cadastre tudo em <strong>Configurações › Integrações</strong>, clique em <strong>Testar conexão</strong> e,
          com o retorno positivo, em <strong>Salvar</strong>.
        </p>
      </>
    ),
  },
  {
    icon: <RefreshCw className="h-5 w-5" />,
    title: 'Sincronização',
    body: (
      <>
        <p>São três modos de sincronização:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><strong>Catálogo</strong> — grupos, veículos, motoristas e última posição;</li>
          <li><strong>Incremental</strong> — o catálogo mais viagens e eventos desde a última execução (padrão);</li>
          <li><strong>Histórico</strong> — recarrega viagens e eventos de um período informado.</li>
        </ul>
        <p className="mt-2">
          O agendamento automático roda no serviço <code>worker</code> e respeita o intervalo escolhido na tela de
          integrações. Toda execução fica registrada em <strong>Histórico</strong>, com contadores por etapa.
        </p>
      </>
    ),
  },
  {
    icon: <Truck className="h-5 w-5" />,
    title: 'Módulo Veículos',
    body: (
      <p>
        Traz a frota completa vinda da Track7: identificação, grupo/site, odômetro, última transmissão e situação
        operacional (em movimento, parado ou sem comunicação). O detalhe de cada veículo reúne cadastro, última
        posição, viagens e eventos recentes. Todos os filtros valem para a exportação em CSV.
      </p>
    ),
  },
  {
    icon: <BookOpen className="h-5 w-5" />,
    title: 'Módulo Relatórios',
    body: (
      <p>
        O catálogo de relatórios é declarativo: cada relatório define seus parâmetros e colunas, e a tela monta
        formulário e tabela automaticamente. É por aí que entram as exigências específicas do órgão gestor — basta
        acrescentar a definição do relatório no catálogo da API, sem mexer no front-end.
      </p>
    ),
  },
  {
    icon: <ShieldCheck className="h-5 w-5" />,
    title: 'Segurança',
    body: (
      <ul className="list-disc space-y-1 pl-5">
        <li>Senhas armazenadas com <strong>scrypt</strong> e sal por usuário;</li>
        <li>Credenciais da Track7 cifradas em repouso com <strong>AES-256-GCM</strong>;</li>
        <li>Sessões com token de acesso curto e <em>refresh token</em> rotativo e revogável;</li>
        <li>Bloqueio temporário após 5 tentativas de login malsucedidas;</li>
        <li>Trilha de auditoria de todas as ações sensíveis.</li>
      </ul>
    ),
  },
  {
    icon: <KeyRound className="h-5 w-5" />,
    title: 'Perfis de acesso',
    body: (
      <ul className="list-disc space-y-1 pl-5">
        <li><strong>Administrador</strong> — tudo, inclusive usuários e integrações;</li>
        <li><strong>Gestor</strong> — integrações, sincronizações e relatórios;</li>
        <li><strong>Operador</strong> — dispara sincronizações e consulta os módulos;</li>
        <li><strong>Consulta</strong> — somente leitura e exportação.</li>
      </ul>
    ),
  },
];

export function HelpPage() {
  return (
    <>
      <PageHeader
        icon={<BookOpen className="h-6 w-6" />}
        title="Ajuda"
        subtitle="Como configurar, operar e estender a plataforma."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {SECTIONS.map((section) => (
          <Card key={section.title} className="p-5">
            <div className="mb-3 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                {section.icon}
              </div>
              <h2 className="text-base font-semibold text-slate-900">{section.title}</h2>
            </div>
            <div className="space-y-2 text-sm leading-relaxed text-slate-600">{section.body}</div>
          </Card>
        ))}
      </div>

      <Card className="mt-4 p-5">
        <h2 className="text-base font-semibold text-slate-900">Referências</h2>
        <ul className="mt-3 space-y-2 text-sm">
          <li>
            <a
              className="inline-flex items-center gap-1 text-brand-600 hover:underline"
              href="https://integrate.us.mixtelematics.com/CustomContent/api-docs-1.html"
              target="_blank"
              rel="noreferrer"
            >
              Documentação MiX Integrate — primeiros passos <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </li>
          <li>
            <a
              className="inline-flex items-center gap-1 text-brand-600 hover:underline"
              href="https://github.com/MiXTelematics/MiX.Integrate.Api.Client"
              target="_blank"
              rel="noreferrer"
            >
              Biblioteca cliente oficial (referência de rotas) <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </li>
        </ul>
      </Card>
    </>
  );
}
