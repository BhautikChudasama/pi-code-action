/**
 * Pi extension: Kubernetes tools
 *
 * Safe, read-heavy k8s operations for debugging and inspection.
 * Uses kubectl under the hood.
 *
 * SAFETY:
 * - Pod delete is allowed (for stuck pods, restarts)
 * - NEVER deletes PVC, PV, namespace, or other critical objects
 * - No apply/create -- this is for observability, not deployment
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  // Check if kubectl is available
  const { execSync } = require("child_process");
  try {
    execSync("which kubectl", { stdio: "pipe" });
  } catch {
    // kubectl not available -- skip registering tools
    return;
  }

  const namespace = process.env.KUBE_NAMESPACE || "";
  const nsFlag = namespace ? `-n ${namespace}` : "";

  /** Run kubectl and return output */
  function kubectl(args: string, timeoutMs = 30000): string {
    try {
      return execSync(`kubectl ${args}`, {
        encoding: "utf-8",
        timeout: timeoutMs,
        env: process.env,
      }).trim();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`kubectl error: ${msg}`);
    }
  }

  // ── k8s_get: Get resources ──

  pi.registerTool({
    name: "k8s_get",
    label: "Get Resources",
    description: "List Kubernetes resources (pods, deployments, services, configmaps, jobs, cronjobs, ingresses, etc.). Returns a table of resources with their status.",
    promptSnippet: "List Kubernetes resources",
    parameters: Type.Object({
      resource: Type.String({ description: "Resource type: pods, deployments, services, configmaps, secrets, jobs, cronjobs, ingresses, nodes, namespaces, hpa, daemonsets, statefulsets, replicasets" }),
      namespace: Type.Optional(Type.String({ description: "Namespace (overrides default)" })),
      selector: Type.Optional(Type.String({ description: "Label selector (e.g. app=myapp)" })),
      all_namespaces: Type.Optional(Type.Boolean({ description: "List across all namespaces" })),
      output: Type.Optional(Type.String({ description: "Output format: wide, yaml, json (default: table)" })),
    }),
    async execute(_id, params) {
      try {
        const ns = params.all_namespaces ? "--all-namespaces" : (params.namespace ? `-n ${params.namespace}` : nsFlag);
        const sel = params.selector ? `-l ${params.selector}` : "";
        const out = params.output ? `-o ${params.output}` : "";
        const result = kubectl(`get ${params.resource} ${ns} ${sel} ${out}`);
        return { content: [{ type: "text", text: result }], details: {} };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: msg }], details: {} };
      }
    },
  });

  // ── k8s_describe: Describe a resource ──

  pi.registerTool({
    name: "k8s_describe",
    label: "Describe Resource",
    description: "Get detailed description of a Kubernetes resource including events, conditions, and configuration.",
    promptSnippet: "Describe a Kubernetes resource in detail",
    parameters: Type.Object({
      resource: Type.String({ description: "Resource type (e.g. pod, deployment, service)" }),
      name: Type.String({ description: "Resource name" }),
      namespace: Type.Optional(Type.String({ description: "Namespace (overrides default)" })),
    }),
    async execute(_id, params) {
      try {
        const ns = params.namespace ? `-n ${params.namespace}` : nsFlag;
        const result = kubectl(`describe ${params.resource} ${params.name} ${ns}`);
        // Truncate very large output
        const maxLen = 30000;
        const truncated = result.length > maxLen ? result.substring(0, maxLen) + "\n... (truncated)" : result;
        return { content: [{ type: "text", text: truncated }], details: {} };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: msg }], details: {} };
      }
    },
  });

  // ── k8s_logs: Get pod logs ──

  pi.registerTool({
    name: "k8s_logs",
    label: "Pod Logs",
    description: "Get logs from a Kubernetes pod. Can tail recent lines, filter by container, or get previous container logs.",
    promptSnippet: "Read Kubernetes pod logs",
    parameters: Type.Object({
      pod: Type.String({ description: "Pod name (or deployment/xxx for deployment pods)" }),
      namespace: Type.Optional(Type.String({ description: "Namespace (overrides default)" })),
      container: Type.Optional(Type.String({ description: "Container name (for multi-container pods)" })),
      tail: Type.Optional(Type.Number({ description: "Number of recent lines to show (default: 100)" })),
      previous: Type.Optional(Type.Boolean({ description: "Show logs from previous (crashed) container" })),
      since: Type.Optional(Type.String({ description: "Show logs since duration (e.g. 1h, 30m, 5s)" })),
    }),
    async execute(_id, params) {
      try {
        const ns = params.namespace ? `-n ${params.namespace}` : nsFlag;
        const container = params.container ? `-c ${params.container}` : "";
        const tail = `--tail=${params.tail || 100}`;
        const prev = params.previous ? "--previous" : "";
        const since = params.since ? `--since=${params.since}` : "";
        const result = kubectl(`logs ${params.pod} ${ns} ${container} ${tail} ${prev} ${since}`, 60000);
        return { content: [{ type: "text", text: result }], details: {} };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: msg }], details: {} };
      }
    },
  });

  // ── k8s_events: Get cluster events ──

  pi.registerTool({
    name: "k8s_events",
    label: "Events",
    description: "Get Kubernetes events, sorted by last timestamp. Useful for debugging pod scheduling failures, crashes, and other issues.",
    promptSnippet: "Show Kubernetes cluster events",
    parameters: Type.Object({
      namespace: Type.Optional(Type.String({ description: "Namespace (overrides default)" })),
      all_namespaces: Type.Optional(Type.Boolean({ description: "Show events across all namespaces" })),
      field_selector: Type.Optional(Type.String({ description: "Field selector (e.g. involvedObject.name=mypod, reason=Failed)" })),
    }),
    async execute(_id, params) {
      try {
        const ns = params.all_namespaces ? "--all-namespaces" : (params.namespace ? `-n ${params.namespace}` : nsFlag);
        const field = params.field_selector ? `--field-selector=${params.field_selector}` : "";
        const result = kubectl(`get events ${ns} ${field} --sort-by=.lastTimestamp`);
        return { content: [{ type: "text", text: result }], details: {} };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: msg }], details: {} };
      }
    },
  });

  // ── k8s_rollout_status: Check deployment rollout ──

  pi.registerTool({
    name: "k8s_rollout_status",
    label: "Rollout Status",
    description: "Check the rollout status of a deployment, statefulset, or daemonset. Shows if the rollout is complete or stuck.",
    promptSnippet: "Check Kubernetes deployment rollout status",
    parameters: Type.Object({
      resource: Type.String({ description: "Resource type and name (e.g. deployment/myapp)" }),
      namespace: Type.Optional(Type.String({ description: "Namespace (overrides default)" })),
    }),
    async execute(_id, params) {
      try {
        const ns = params.namespace ? `-n ${params.namespace}` : nsFlag;
        const result = kubectl(`rollout status ${params.resource} ${ns}`, 60000);
        return { content: [{ type: "text", text: result }], details: {} };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: msg }], details: {} };
      }
    },
  });

  // ── k8s_top: Resource usage ──

  pi.registerTool({
    name: "k8s_top",
    label: "Resource Usage",
    description: "Show CPU and memory usage for pods or nodes. Requires metrics-server to be installed in the cluster.",
    promptSnippet: "Show Kubernetes resource usage (CPU/memory)",
    parameters: Type.Object({
      resource: Type.String({ description: "pods or nodes" }),
      namespace: Type.Optional(Type.String({ description: "Namespace (overrides default)" })),
      selector: Type.Optional(Type.String({ description: "Label selector" })),
    }),
    async execute(_id, params) {
      try {
        const ns = params.namespace ? `-n ${params.namespace}` : nsFlag;
        const sel = params.selector ? `-l ${params.selector}` : "";
        const result = kubectl(`top ${params.resource} ${ns} ${sel}`);
        return { content: [{ type: "text", text: result }], details: {} };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: msg }], details: {} };
      }
    },
  });

  // ── k8s_delete_pod: Delete a pod (for restarts) ──

  pi.registerTool({
    name: "k8s_delete_pod",
    label: "Delete Pod",
    description: "Delete a specific pod. The controller (deployment/statefulset) will recreate it. Use this for stuck pods or to trigger a restart. ONLY pods can be deleted -- PVCs, PVs, namespaces, deployments, and other objects cannot be deleted with this tool.",
    promptSnippet: "Delete a pod to trigger restart",
    promptGuidelines: [
      "Only use this for pods that are stuck, crashlooping, or need a restart.",
      "The pod will be recreated automatically by its controller (deployment, statefulset, etc.).",
      "NEVER use this to delete all pods in a namespace. Delete one at a time.",
    ],
    parameters: Type.Object({
      pod: Type.String({ description: "Pod name to delete" }),
      namespace: Type.Optional(Type.String({ description: "Namespace (overrides default)" })),
      grace_period: Type.Optional(Type.Number({ description: "Grace period in seconds (default: 30, use 0 for immediate)" })),
    }),
    async execute(_id, params) {
      // Safety: reject anything that looks like a wildcard or --all
      if (params.pod.includes("*") || params.pod === "--all" || params.pod === "-all") {
        return {
          content: [{ type: "text", text: "Refused: cannot delete pods with wildcards or --all. Delete one pod at a time." }],
          details: {},
        };
      }

      try {
        const ns = params.namespace ? `-n ${params.namespace}` : nsFlag;
        const grace = params.grace_period !== undefined ? `--grace-period=${params.grace_period}` : "";
        const result = kubectl(`delete pod ${params.pod} ${ns} ${grace}`);
        return { content: [{ type: "text", text: result }], details: {} };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: msg }], details: {} };
      }
    },
  });

  // ── k8s_rollout_restart: Restart a deployment ──

  pi.registerTool({
    name: "k8s_rollout_restart",
    label: "Rollout Restart",
    description: "Trigger a rolling restart of a deployment, statefulset, or daemonset. All pods will be recreated one by one.",
    promptSnippet: "Rolling restart a deployment",
    parameters: Type.Object({
      resource: Type.String({ description: "Resource type and name (e.g. deployment/myapp)" }),
      namespace: Type.Optional(Type.String({ description: "Namespace (overrides default)" })),
    }),
    async execute(_id, params) {
      try {
        const ns = params.namespace ? `-n ${params.namespace}` : nsFlag;
        const result = kubectl(`rollout restart ${params.resource} ${ns}`);
        return { content: [{ type: "text", text: result }], details: {} };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: msg }], details: {} };
      }
    },
  });

  // ── k8s_exec: Run a command in a pod ──

  pi.registerTool({
    name: "k8s_exec",
    label: "Exec in Pod",
    description: "Execute a command inside a running pod. Useful for debugging -- checking files, running diagnostic commands, testing connectivity.",
    promptSnippet: "Execute a command inside a Kubernetes pod",
    parameters: Type.Object({
      pod: Type.String({ description: "Pod name" }),
      command: Type.String({ description: "Command to run (e.g. 'cat /etc/config' or 'curl localhost:8080/health')" }),
      namespace: Type.Optional(Type.String({ description: "Namespace (overrides default)" })),
      container: Type.Optional(Type.String({ description: "Container name (for multi-container pods)" })),
    }),
    async execute(_id, params) {
      try {
        const ns = params.namespace ? `-n ${params.namespace}` : nsFlag;
        const container = params.container ? `-c ${params.container}` : "";
        const result = kubectl(`exec ${params.pod} ${ns} ${container} -- ${params.command}`, 30000);
        return { content: [{ type: "text", text: result }], details: {} };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: msg }], details: {} };
      }
    },
  });
}
