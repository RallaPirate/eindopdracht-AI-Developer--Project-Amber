"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type MutateOptions,
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

export type AuthenticatedMutationCallbackContext = AuthenticatedMutationContext & {
  cache: {
    /** Scope excludes the auth-user/user-id prefix. Values only, no updater functions.
     * Updates an existing query from this epoch; missing queries are left for refetch.
     * Stale capabilities silently do nothing, including after an await. */
    setQueryData: <T>(scope: readonly unknown[], data: T) => void;
    invalidateQueries: (scope: readonly unknown[]) => Promise<void>;
  };
};

type MutationCallbacks<TData, TError, TVariables, TOnMutateResult> = {
  onMutate?: (
    variables: TVariables, context: AuthenticatedMutationCallbackContext,
  ) => TOnMutateResult | Promise<TOnMutateResult>;
  onSuccess?: (
    data: TData, variables: TVariables, result: TOnMutateResult | undefined,
    context: AuthenticatedMutationCallbackContext,
  ) => unknown;
  onError?: (
    error: TError, variables: TVariables, result: TOnMutateResult | undefined,
    context: AuthenticatedMutationCallbackContext,
  ) => unknown;
  onSettled?: (
    data: TData | undefined, error: TError | null, variables: TVariables,
    result: TOnMutateResult | undefined, context: AuthenticatedMutationCallbackContext,
  ) => unknown;
};

type MutationCallArgs<TData, TError, TVariables, TOnMutateResult> =
  undefined extends TVariables
    ? [variables?: TVariables, callbacks?: Omit<MutationCallbacks<TData, TError, TVariables, TOnMutateResult>, "onMutate">]
    : [variables: TVariables, callbacks?: Omit<MutationCallbacks<TData, TError, TVariables, TOnMutateResult>, "onMutate">];

type AuthenticatedMutationResult<TData, TError, TVariables, TOnMutateResult> =
  Omit<UseMutationResult<TData, TError, TVariables, TOnMutateResult>, "mutate" | "mutateAsync"> & {
    mutate: (...args: MutationCallArgs<TData, TError, TVariables, TOnMutateResult>) => void;
    mutateAsync: (...args: MutationCallArgs<TData, TError, TVariables, TOnMutateResult>) => Promise<TData>;
  };

export function useVerifiedAuthSnapshot(): AuthAccessSnapshot {
  return useSyncExternalStore(
    subscribeVerifiedAuthSnapshot,
    getVerifiedAuthSnapshot,
    getVerifiedAuthSnapshot,
  );
}

function accessNotReady(): boolean {
  return getVerifiedAuthSnapshot().status !== "ready";
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
    "mutationKey" | "mutationFn" | "onMutate" | "onSuccess" | "onError" | "onSettled"
  > & MutationCallbacks<TData, TError, TVariables, TOnMutateResult> & {
    mutationKey?: readonly unknown[];
    mutationFn: (
      variables: TVariables,
      context: AuthenticatedMutationContext,
    ) => Promise<TData>;
  };

/**
 * Section 3 contract: callbacks may await, but protected cache changes MUST use
 * the supplied context.cache capability, which checks access at each operation.
 * It scopes keys to the invocation's user and never exposes a raw QueryClient.
 * Capturing/importing an unrestricted client, mutating cached objects in place,
 * or scheduling unguarded side effects is unsupported: this hook cannot secure
 * arbitrary application code. Use immutable values with cache.setQueryData;
 * use cache.invalidateQueries when a query needs to be fetched/created.
 * Hook callbacks are awaited by TanStack; per-call callbacks keep TanStack's
 * fire-and-forget semantics. Both receive the same restricted cache capability.
 * Neither observer reset nor a stale rejection reverses a committed server write.
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
): AuthenticatedMutationResult<TData, TError, TVariables, TOnMutateResult> {
  const queryClient = useQueryClient();
  const access = useVerifiedAuthSnapshot();
  const { userId, accessEpoch } = access;
  const {
    mutationKey = [],
    mutationFn,
    onMutate,
    onSuccess,
    onError,
    onSettled,
    ...rest
  } = options;
  // Private variables retain access per invocation, including overlapping calls
  // and retries, without changing the caller's optimistic-update context.
  type Invocation = { variables: TVariables; access: AuthenticatedAccess };
  const current = (call: Invocation) =>
    accessCurrent(call.access) && !accessNotReady();
  const requireCurrent = (call: Invocation) => {
    if (!current(call)) throw new AuthenticatedQueryIdentityError();
  };
  const callbackContext = (call: Invocation): AuthenticatedMutationCallbackContext => ({
    userId: call.access.userId,
    cache: {
      setQueryData: (scope, data) => {
        if (!current(call)) return;
        // TanStack interprets functions as updaters. Do not run arbitrary code
        // between the access check and the write.
        if (typeof data === "function") throw new TypeError("Cache updates require a value.");
        const queryKey = authenticatedQueryKey(call.access.userId, scope);
        const query = queryClient.getQueryCache().find({ queryKey, exact: true });
        if (query?.meta?.accessEpoch !== call.access.epoch) return;
        queryClient.setQueryData(queryKey, data);
      },
      invalidateQueries: (scope) => {
        if (!current(call)) return Promise.resolve();
        return queryClient.invalidateQueries({
          queryKey: authenticatedQueryKey(call.access.userId, scope),
        });
      },
    },
  });
  const mutation = useMutation<TData, TError, Invocation, TOnMutateResult>({
    ...rest,
    mutationKey: [
      ...(userId
        ? authenticatedQueryKey(userId, mutationKey)
        : unverifiedQueryKey(mutationKey)),
      accessEpoch,
    ],
    mutationFn: async (call) => {
      requireCurrent(call);
      const data = await mutationFn(call.variables, { userId: call.access.userId });
      requireCurrent(call);
      return data;
    },
    onMutate: async (call) => {
      requireCurrent(call);
      const result = await onMutate?.(call.variables, callbackContext(call));
      requireCurrent(call);
      return result as TOnMutateResult;
    },
    onSuccess: (data, call, result) => {
      if (current(call)) return onSuccess?.(data, call.variables, result, callbackContext(call));
    },
    onError: (error, call, result) => {
      if (current(call) && !(error instanceof AuthenticatedQueryIdentityError))
        return onError?.(error, call.variables, result, callbackContext(call));
    },
    onSettled: (data, error, call, result) => {
      if (current(call) && !(error instanceof AuthenticatedQueryIdentityError))
        return onSettled?.(data, error, call.variables, result, callbackContext(call));
    },
  });
  const { reset } = mutation;
  useEffect(() => {
    reset();
  }, [accessEpoch, reset]);

  const mutateAsync: AuthenticatedMutationResult<TData, TError, TVariables, TOnMutateResult>["mutateAsync"] =
    (...args) => {
      const [variables, callbacks] = args;
      const invocation: Invocation = {
        variables: variables as TVariables,
        access: { userId: userId ?? "", epoch: accessEpoch },
      };
      const guarded: MutateOptions<TData, TError, Invocation, TOnMutateResult> = {
        onSuccess: (data, call, result) => {
          if (current(call)) callbacks?.onSuccess?.(data, call.variables, result, callbackContext(call));
        },
        onError: (error, call, result) => {
          if (current(call) && !(error instanceof AuthenticatedQueryIdentityError))
            callbacks?.onError?.(error, call.variables, result, callbackContext(call));
        },
        onSettled: (data, error, call, result) => {
          if (current(call) && !(error instanceof AuthenticatedQueryIdentityError))
            callbacks?.onSettled?.(data, error, call.variables, result, callbackContext(call));
        },
      };
      return mutation.mutateAsync(invocation, guarded).then((data) => {
        requireCurrent(invocation);
        return data;
      });
    };
  const mutate: AuthenticatedMutationResult<TData, TError, TVariables, TOnMutateResult>["mutate"] =
    (...args) => { void mutateAsync(...args).catch(() => {}); };

  // Hide a previous observer result during the boundary render, before the
  // epoch-key/reset effects run. Reset also detaches pending old mutations.
  if (mutation.variables && !current(mutation.variables)) {
    return {
      ...mutation, data: undefined, error: null, context: undefined,
      variables: undefined, status: "idle", isIdle: true, isPending: false,
      isSuccess: false, isError: false, failureCount: 0, failureReason: null,
      submittedAt: 0, isPaused: false, mutate, mutateAsync,
    };
  }
  return {
    ...mutation, variables: mutation.variables?.variables, mutate, mutateAsync,
  } as AuthenticatedMutationResult<TData, TError, TVariables, TOnMutateResult>;
}
