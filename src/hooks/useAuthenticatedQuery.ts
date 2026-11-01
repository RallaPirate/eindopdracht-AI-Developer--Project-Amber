"use client";

import { useRef, useSyncExternalStore } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryFunctionContext,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  getVerifiedAuthSnapshot,
  subscribeVerifiedAuthSnapshot,
} from "@/lib/queryClient";
import {
  AUTHENTICATED_QUERY_ROOT,
  AuthenticatedQueryIdentityError,
  authenticatedQueryKey,
  isAuthenticatedAccessCurrent,
  shouldRunAuthenticatedQuery,
  stripPrivilegedQueryOptions,
  unverifiedQueryKey,
  type AuthenticatedAccess,
  type AuthAccessSnapshot,
} from "@/lib/queryCacheIsolation";

export type AuthenticatedQueryContext = {
  userId: string;
  signal: AbortSignal;
  queryKey: readonly unknown[];
  meta: QueryFunctionContext["meta"];
};

export type AuthenticatedMutationContext = {
  userId: string;
};

function useVerifiedAuthSnapshot(): AuthAccessSnapshot {
  return useSyncExternalStore(
    subscribeVerifiedAuthSnapshot,
    getVerifiedAuthSnapshot,
    getVerifiedAuthSnapshot,
  );
}

function accessNotReady(): boolean {
  return getVerifiedAuthSnapshot().status !== "ready";
}

function dropAuthenticatedQueries(
  queryClient: ReturnType<typeof useQueryClient>,
) {
  queryClient.removeQueries({
    predicate: (query) => query.queryKey[0] === AUTHENTICATED_QUERY_ROOT,
  });
}

function accessCurrent(started: AuthenticatedAccess): boolean {
  return isAuthenticatedAccessCurrent(
    getVerifiedAuthSnapshot().userId,
    getVerifiedAuthSnapshot().accessEpoch,
    started,
  );
}

function retryUnlessIdentityChanged<TError>(
  retry: UseQueryOptions<unknown, TError>["retry"],
): (failureCount: number, error: TError) => boolean {
  return (failureCount, error) => {
    if (error instanceof AuthenticatedQueryIdentityError) return false;
    if (typeof retry === "function") return retry(failureCount, error);
    if (typeof retry === "number") return failureCount < retry;
    if (retry === false) return false;
    if (retry === true) return true;
    return failureCount < 3;
  };
}

type AuthenticatedQueryOptions<TData, TError> = Omit<
  UseQueryOptions<TData, TError, TData, readonly unknown[]>,
  | "queryKey"
  | "queryFn"
  | "enabled"
  | "placeholderData"
  | "initialData"
  | "initialDataUpdatedAt"
> & {
  queryKey: readonly unknown[];
  queryFn: (context: AuthenticatedQueryContext) => Promise<TData>;
  enabled?: boolean;
};

/**
 * Query hook for data that belongs to the signed-in user.
 * The query key includes the verified Auth user id, and the query does not
 * run until that id is known. A response that finishes after logout or an
 * account switch is discarded.
 */
export function useAuthenticatedQuery<TData, TError = Error>(
  options: AuthenticatedQueryOptions<TData, TError>,
): UseQueryResult<TData, TError> {
  const access = useVerifiedAuthSnapshot();
  const { userId, accessEpoch: epoch, permissionStatus } = access;
  const { queryKey, queryFn, enabled, retry, meta, ...rest } = options;
  const safeOptions = stripPrivilegedQueryOptions(rest);

  return useQuery({
    ...safeOptions,
    queryKey: userId
      ? authenticatedQueryKey(userId, queryKey)
      : unverifiedQueryKey(queryKey),
    enabled: shouldRunAuthenticatedQuery(userId, enabled, permissionStatus),
    retry: retryUnlessIdentityChanged(retry),
    meta: { ...meta, authUserId: userId, accessEpoch: epoch },
    queryFn: async (context) => {
      const metaEpoch = context.meta?.accessEpoch;
      const attempt: AuthenticatedAccess = {
        userId: userId ?? "",
        epoch: typeof metaEpoch === "number" ? metaEpoch : -1,
      };
      if (!userId || !accessCurrent(attempt) || accessNotReady()) {
        throw new AuthenticatedQueryIdentityError();
      }

      const data = await queryFn({
        userId,
        signal: context.signal,
        queryKey: context.queryKey,
        meta: context.meta,
      });

      if (!accessCurrent(attempt) || accessNotReady()) {
        throw new AuthenticatedQueryIdentityError();
      }

      return data;
    },
  });
}

type AuthenticatedMutationOptions<TData, TError, TVariables, TOnMutateResult> =
  Omit<
    UseMutationOptions<TData, TError, TVariables, TOnMutateResult>,
    "mutationKey" | "mutationFn"
  > & {
    mutationKey?: readonly unknown[];
    mutationFn: (
      variables: TVariables,
      context: AuthenticatedMutationContext,
    ) => Promise<TData>;
  };

/**
 * Mutation hook whose cache callbacks do not run after the access epoch
 * changes. The epoch moves on sign-out, account switch, same-user
 * reauthentication and permission changes, not only when the Auth user id
 * changes. Skipping the callbacks leaves a completed server write in place:
 * cancellation is not treated as a rollback of that write.
 */
export function useAuthenticatedMutation<
  TData = unknown,
  TError = Error,
  TVariables = void,
  TOnMutateResult = unknown,
>(
  options: AuthenticatedMutationOptions<
    TData,
    TError,
    TVariables,
    TOnMutateResult
  >,
): UseMutationResult<TData, TError, TVariables, TOnMutateResult> {
  const queryClient = useQueryClient();
  const access = useVerifiedAuthSnapshot();
  const { userId } = access;
  const {
    mutationKey = [],
    mutationFn,
    onMutate,
    onSuccess,
    onError,
    onSettled,
    ...rest
  } = options;
  const attemptRef = useRef<AuthenticatedAccess | null>(null);

  const attemptStillCurrent = () => {
    const attempt = attemptRef.current;
    return attempt !== null && accessCurrent(attempt);
  };

  return useMutation({
    ...rest,
    mutationKey: userId
      ? authenticatedQueryKey(userId, mutationKey)
      : unverifiedQueryKey(mutationKey),
    mutationFn: async (variables) => {
      if (!attemptStillCurrent() || !userId || accessNotReady()) {
        dropAuthenticatedQueries(queryClient);
        throw new AuthenticatedQueryIdentityError();
      }

      const data = await mutationFn(variables, { userId });

      if (!attemptStillCurrent() || accessNotReady()) {
        dropAuthenticatedQueries(queryClient);
        throw new AuthenticatedQueryIdentityError();
      }

      return data;
    },
    onMutate: async (variables, context) => {
      const attempt: AuthenticatedAccess = {
        userId: getVerifiedAuthSnapshot().userId ?? "",
        epoch: getVerifiedAuthSnapshot().accessEpoch,
      };
      attemptRef.current = attempt;
      if (
        !getVerifiedAuthSnapshot().userId ||
        !accessCurrent(attempt) ||
        accessNotReady()
      ) {
        throw new AuthenticatedQueryIdentityError();
      }
      const result = onMutate
        ? await onMutate(variables, context)
        : (undefined as TOnMutateResult);
      if (!accessCurrent(attempt) || accessNotReady()) {
        dropAuthenticatedQueries(queryClient);
        throw new AuthenticatedQueryIdentityError();
      }
      return result;
    },
    onSuccess: (data, variables, onMutateResult, context) => {
      if (!attemptStillCurrent()) return;
      return onSuccess?.(data, variables, onMutateResult, context);
    },
    onError: (error, variables, onMutateResult, context) => {
      if (!attemptStillCurrent()) return;
      if (error instanceof AuthenticatedQueryIdentityError) return;
      return onError?.(error, variables, onMutateResult, context);
    },
    onSettled: (data, error, variables, onMutateResult, context) => {
      if (!attemptStillCurrent()) return;
      if (error instanceof AuthenticatedQueryIdentityError) return;
      return onSettled?.(data, error, variables, onMutateResult, context);
    },
  });
}
