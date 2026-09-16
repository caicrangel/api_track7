import { useQuery } from '@tanstack/react-query';
import { Search, UsersRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import {
  Alert,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Pagination,
  Spinner,
  Table,
  Td,
  Th,
} from '../components/ui';

interface Driver {
  driver_id: number;
  name: string | null;
  employee_number: string | null;
  mobile_number: string | null;
  email: string | null;
  site_name: string | null;
  synced_at: string | null;
}

export function DriversPage() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['drivers', debounced, page],
    queryFn: () =>
      api<{ data: Driver[]; page: number; pageSize: number; total: number }>('/drivers', {
        query: { search: debounced, page, pageSize: 25 },
      }),
  });

  return (
    <>
      <PageHeader
        icon={<UsersRound className="h-6 w-6" />}
        title="Motoristas"
        subtitle="Condutores cadastrados na Track7 e vinculados às viagens da frota."
      />

      <Card className="mb-4 p-4">
        <Field label="Buscar" className="max-w-md">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nome ou matrícula"
              className="pl-9"
            />
          </div>
        </Field>
      </Card>

      <Card>
        {isLoading ? (
          <Spinner />
        ) : error ? (
          <div className="p-4">
            <Alert tone="danger">Não foi possível carregar os motoristas.</Alert>
          </div>
        ) : !data?.data.length ? (
          <EmptyState
            icon={<UsersRound className="h-10 w-10" />}
            title="Nenhum motorista sincronizado"
            description="Os motoristas são importados junto com a sincronização da Track7."
          />
        ) : (
          <>
            <Table>
              <thead className="bg-slate-50">
                <tr>
                  <Th>Nome</Th>
                  <Th>Matrícula</Th>
                  <Th>Grupo / Site</Th>
                  <Th>Telefone</Th>
                  <Th>E-mail</Th>
                  <Th>Sincronizado</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.data.map((driver) => (
                  <tr key={driver.driver_id} className="hover:bg-slate-50/70">
                    <Td className="font-medium text-slate-800">{driver.name ?? `Motorista ${driver.driver_id}`}</Td>
                    <Td>{driver.employee_number ?? '—'}</Td>
                    <Td>{driver.site_name ?? '—'}</Td>
                    <Td>{driver.mobile_number ?? '—'}</Td>
                    <Td>{driver.email ?? '—'}</Td>
                    <Td>{formatDateTime(driver.synced_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
