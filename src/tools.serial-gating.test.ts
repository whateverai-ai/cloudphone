import test from "node:test";
import assert from "node:assert/strict";
import { setConfig, tools } from "./tools";

type JsonRecord = Record<string, unknown>;

function parseToolText(result: { content: Array<{ type: string; text?: string }> }): JsonRecord {
  const text = result.content[0]?.text ?? "{}";
  return JSON.parse(text) as JsonRecord;
}

function getTool(name: string) {
  const tool = tools.find((item) => item.name === name);
  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }
  return tool;
}

function sseResponse(chunk: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    body,
  } as unknown as Response;
}

function mockFetch(mode: "running_then_success" | "error" | "timeout") {
  let taskSeq = 1000;
  const resultCallCount = new Map<number, number>();
  return async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url.includes("/devices/execute")) {
      taskSeq += 1;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        async json() {
          return {
            status: "ok",
            taskId: taskSeq,
            sessionId: "s1",
            message: "accepted",
          };
        },
      } as unknown as Response;
    }

    if (mode === "timeout") {
      throw new Error("network timeout");
    }

    const match = url.match(/\/devices\/result\/(\d+)/);
    const taskId = Number(match?.[1] ?? 0);
    const count = (resultCallCount.get(taskId) ?? 0) + 1;
    resultCallCount.set(taskId, count);

    if (mode === "error") {
      return sseResponse('event: error\ndata: {"message":"failed"}\n\n');
    }

    if (count === 1) {
      return sseResponse('event: agent_thinking\ndata: {"content":"step-1"}\n\n');
    }
    if (count === 2) {
      return sseResponse('event: agent_thinking\ndata: {"content":"step-2"}\n\n');
    }
    return sseResponse(
      'event: task_result\ndata: {"status":"success","message":"ok"}\n\nevent: done\ndata: {}\n\n'
    );
  };
}

test("cloudphone_execute rejects concurrent task with AGENT_BUSY", async () => {
  setConfig({ baseUrl: "https://whateverai.ai/ai", timeout: 1000 });
  globalThis.fetch = mockFetch("timeout");
  const executeTool = getTool("cloudphone_execute");

  const first = parseToolText(
    await executeTool.execute("id-1", {
      instruction: "first task",
      session_id: "serial-case-1",
    })
  );
  assert.equal(first.ok, true);
  assert.equal(typeof first.task_id, "number");

  const second = parseToolText(
    await executeTool.execute("id-2", {
      instruction: "second task",
      session_id: "serial-case-1",
    })
  );
  assert.equal(second.ok, false);
  assert.equal(second.code, "AGENT_BUSY");
  assert.equal(second.blocking_task_id, first.task_id);
});

test("running result keeps lock until terminal status", async () => {
  setConfig({ baseUrl: "https://whateverai.ai/ai", timeout: 1000 });
  globalThis.fetch = mockFetch("running_then_success");
  const executeTool = getTool("cloudphone_execute");
  const resultTool = getTool("cloudphone_task_result");

  const firstExecute = parseToolText(
    await executeTool.execute("exec-running-1", {
      instruction: "task-running",
      session_id: "serial-case-running",
    })
  );
  assert.equal(firstExecute.ok, true);

  const firstTaskId = Number(firstExecute.task_id);
  const firstPoll = parseToolText(
    await resultTool.execute("result-running-1", {
      task_id: firstTaskId,
    })
  );
  assert.equal(firstPoll.status, "running");
  assert.deepEqual(firstPoll.thinking, ["step-1"]);

  const blockedExecute = parseToolText(
    await executeTool.execute("exec-running-2", {
      instruction: "task-running-next",
      session_id: "serial-case-running",
    })
  );
  assert.equal(blockedExecute.ok, false);
  assert.equal(blockedExecute.code, "AGENT_BUSY");
});

for (const mode of ["running_then_success", "error"] as const) {
  test(`terminal result '${mode}' unlocks next execute`, async () => {
    setConfig({ baseUrl: "https://whateverai.ai/ai", timeout: 1000 });
    globalThis.fetch = mockFetch(mode);
    const executeTool = getTool("cloudphone_execute");
    const resultTool = getTool("cloudphone_task_result");

    const firstExecute = parseToolText(
      await executeTool.execute(`exec-${mode}-1`, {
        instruction: `task-${mode}`,
        session_id: `serial-case-${mode}`,
      })
    );
    assert.equal(firstExecute.ok, true);

    const firstTaskId = Number(firstExecute.task_id);
    let taskResult = parseToolText(
      await resultTool.execute(`result-${mode}`, {
        task_id: firstTaskId,
      })
    );
    if (mode === "running_then_success") {
      assert.equal(taskResult.status, "running");
      assert.deepEqual(taskResult.thinking, ["step-1"]);
      taskResult = parseToolText(
        await resultTool.execute(`result-${mode}-2`, {
          task_id: firstTaskId,
        })
      );
      assert.equal(taskResult.status, "running");
      assert.deepEqual(taskResult.thinking, ["step-2"]);
      taskResult = parseToolText(
        await resultTool.execute(`result-${mode}-3`, {
          task_id: firstTaskId,
        })
      );
    }

    if (mode === "running_then_success") {
      assert.equal(taskResult.ok, true);
      assert.equal(taskResult.status, "success");
    } else {
      assert.equal(taskResult.ok, false);
      assert.equal(taskResult.status, "error");
    }

    const secondExecute = parseToolText(
      await executeTool.execute(`exec-${mode}-2`, {
        instruction: `task-${mode}-again`,
        session_id: `serial-case-${mode}`,
      })
    );
    assert.equal(secondExecute.ok, true);
  });
}

test("cloudphone_execute_and_wait auto chains first poll", async () => {
  setConfig({ baseUrl: "https://whateverai.ai/ai", timeout: 1000 });
  globalThis.fetch = mockFetch("running_then_success");
  const chainTool = getTool("cloudphone_execute_and_wait");

  const result = parseToolText(
    await chainTool.execute("chain-1", {
      instruction: "chain task",
      session_id: "chain-case-1",
    })
  );

  assert.equal(typeof result.task_id, "number");
  const taskResult = result.task_result as JsonRecord;
  assert.equal(taskResult.status, "running");
  assert.deepEqual(taskResult.thinking, ["step-1"]);
});
