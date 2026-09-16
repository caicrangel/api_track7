import { useQuery } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';

export interface Operator {
  id: string;
  name: string;
  shortName: string | null;
  code: string | null;
  document: string | null;
  provider: string;
  status: 'ACTIVE' | 'INACTIVE';
  notes: string | null;
  createdAt: string;
  stats: {
    veiculos: number;
    credenciais: boolean;
    ultima_posicao: string | null;
    ultima_sync: string | null;
  } | null;
}

const STORAGE_KEY = 'fleetgov.operatorId';

interface OperatorContextValue {
  operators: Operator[];
  /** null = visão consolidada de todas as operadoras. */
  operatorId: string | null;
  operator: Operator | null;
  setOperatorId: (id: string | null) => void;
  loading: boolean;
  refresh: () => void;
}

const OperatorContext = createContext<OperatorContextValue | null>(null);

export function OperatorProvider({ children }: { children: ReactNode }) {
  const [operatorId, setOperatorIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['operators'],
    queryFn: () => api<{ operators: Operator[] }>('/operators'),
    staleTime: 60_000,
  });

  const operators = useMemo(() => data?.operators ?? [], [data]);

  // Com uma única operadora não faz sentido oferecer escolha: assume ela.
  // E se a operadora salva sumiu, volta para a visão consolidada.
  useEffect(() => {
    if (!operators.length) return;
    if (operators.length === 1) {
      if (operatorId !== operators[0].id) setOperatorIdState(operators[0].id);
      return;
    }
    if (operatorId && !operators.some((o) => o.id === operatorId)) {
      setOperatorIdState(null);
    }
  }, [operators, operatorId]);

  const setOperatorId = useCallback((id: string | null) => {
    setOperatorIdState(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* a seleção continua valendo nesta sessão mesmo sem storage */
    }
  }, []);

  const value = useMemo<OperatorContextValue>(
    () => ({
      operators,
      operatorId,
      operator: operators.find((o) => o.id === operatorId) ?? null,
      setOperatorId,
      loading: isLoading,
      refresh: () => void refetch(),
    }),
    [operators, operatorId, setOperatorId, isLoading, refetch],
  );

  return <OperatorContext.Provider value={value}>{children}</OperatorContext.Provider>;
}

export function useOperator(): OperatorContextValue {
  const context = useContext(OperatorContext);
  if (!context) throw new Error('useOperator precisa estar dentro de <OperatorProvider>');
  return context;
}

/**
 * Parâmetro de escopo para as chamadas à API.
 * `undefined` faz a consulta trazer todas as operadoras (consolidado).
 */
export function operatorParam(operatorId: string | null): string | undefined {
  return operatorId ?? undefined;
}
