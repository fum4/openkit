import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  fetchNotes,
  updateNotes,
  addTodo,
  updateTodo,
  deleteTodo,
  updateGitPolicy,
  updateHookSkills,
} from "./api";
import type { GitPolicyOverride, IssueNotes, HookSkillOverride } from "./api";
import { useServerUrlOptional } from "../contexts/ServerContext";

export function useNotes(source: string, id: string | null) {
  const serverUrl = useServerUrlOptional();
  const queryClient = useQueryClient();
  const queryKey = ["notes", source, id, serverUrl];

  const { data, isLoading, error, refetch } = useQuery<IssueNotes>({
    queryKey,
    queryFn: () => fetchNotes(source, id!, serverUrl),
    enabled: !!id && serverUrl !== null,
    staleTime: 3_000,
    refetchInterval: 3_000,
  });

  const updateSection = async (section: "personal" | "aiContext", content: string) => {
    if (!id) return;
    const result = await updateNotes(source, id, section, content, serverUrl);
    queryClient.setQueryData(queryKey, result);
    return result;
  };

  const addTodoItem = async (text: string) => {
    if (!id) return;
    const result = await addTodo(source, id, text, serverUrl);
    queryClient.setQueryData(queryKey, result);
    return result;
  };

  const toggleTodo = async (todoId: string) => {
    if (!id || !data) return;
    const todo = data.todos.find((t) => t.id === todoId);
    if (!todo) return;
    const result = await updateTodo(source, id, todoId, { checked: !todo.checked }, serverUrl);
    queryClient.setQueryData(queryKey, result);
    return result;
  };

  const deleteTodoItem = async (todoId: string) => {
    if (!id) return;
    const result = await deleteTodo(source, id, todoId, serverUrl);
    queryClient.setQueryData(queryKey, result);
    return result;
  };

  const updateTodoText = async (todoId: string, text: string) => {
    if (!id) return;
    const result = await updateTodo(source, id, todoId, { text }, serverUrl);
    queryClient.setQueryData(queryKey, result);
    return result;
  };

  const updateGitPolicyMutation = async (policy: {
    agentCommits?: GitPolicyOverride;
    agentPushes?: GitPolicyOverride;
    agentPRs?: GitPolicyOverride;
  }) => {
    if (!id) return;
    const result = await updateGitPolicy(source, id, policy, serverUrl);
    queryClient.setQueryData(queryKey, result);
    return result;
  };

  const updateHookSkillsMutation = async (overrides: Record<string, HookSkillOverride>) => {
    if (!id) return;
    const result = await updateHookSkills(source, id, overrides, serverUrl);
    queryClient.setQueryData(queryKey, result);
    return result;
  };

  return {
    notes: data ?? null,
    isLoading,
    error: error instanceof Error ? error.message : null,
    updateSection,
    addTodo: addTodoItem,
    toggleTodo,
    deleteTodo: deleteTodoItem,
    updateTodoText,
    updateGitPolicy: updateGitPolicyMutation,
    updateHookSkills: updateHookSkillsMutation,
    refetch,
  };
}
