"""Derived data for datasets. E.g. tool description, etc."""

import asyncio
import json
from typing import Annotated, Tuple
from uuid import UUID

from attr import dataclass
from fastapi import APIRouter, Depends, HTTPException, Request
from models.datasets_and_traces import Trace, db
from routes.auth import AuthenticatedUserIdentity
from routes.dataset.utils import load_dataset
from sqlalchemy.orm import Session

router = APIRouter()
from typing import Any
from collections import defaultdict


class ToolTransitionGraphBuilder:
    def __init__(self):
        self.transitions: dict[tuple[str, str], float] = defaultdict(float)

    def add_trace(self, trace: Trace):
        tool_sequence: list[str] = []

        for event in trace.content:
            for call in event.get("tool_calls", []) or []:
                name = call.get("function", {}).get("name")
                if name:
                    tool_sequence.append(name)

        if not tool_sequence:
            return

        # count transitions with weight = 1 / trace length
        weight = 1.0 / len(tool_sequence) if len(tool_sequence) > 1 else 1.0
        for i in range(len(tool_sequence) - 1):
            src = tool_sequence[i]
            dst = tool_sequence[i + 1]
            self.transitions[(src, dst)] += weight

    def export(self) -> list[dict[str, str | float]]:
        return [
            {"from": src, "to": dst, "weight": weight}
            for (src, dst), weight in self.transitions.items()
        ]


def infer_type(value: Any) -> str:
    if isinstance(value, list):
        if not value:
            return "list[Any]"
        elem_types = {infer_type(v) for v in value}
        return f"list[{ ' | '.join(sorted(elem_types)) }]"

    elif isinstance(value, dict):
        if not value:
            return "dict[Any, Any]"
        fields = {}
        for k, v in value.items():
            k_str = str(k)
            t = infer_type(v)
            fields[k_str] = union(fields.get(k_str, t), t)
        inner = ", ".join(f"{k}: {v}" for k, v in sorted(fields.items()))
        return f"{{{inner}}}"  # Structural type

    elif value is None:
        return "None"

    return type(value).__name__


def union(t1: str, t2: str) -> str:
    if t1 == t2:
        return t1

    # Merge structural dicts like {a: str} | {a: str | int}
    if t1.startswith("{") and t2.startswith("{"):

        def parse_struct(s: str):
            fields = {}
            for part in s.strip("{}").split(","):
                if not part.strip():
                    continue
                key, val = part.split(":")
                fields[key.strip()] = val.strip()
            return fields

        f1 = parse_struct(t1)
        f2 = parse_struct(t2)
        keys = set(f1) | set(f2)
        merged = {k: union(f1.get(k, "None"), f2.get(k, "None")) for k in keys}
        inner = ", ".join(f"{k}: {v}" for k, v in sorted(merged.items()))
        return f"{{{inner}}}"

    return " | ".join(sorted(set(t1.split(" | ")) | set(t2.split(" | "))))


class Tool:
    def __init__(self, name: str):
        self.name = name
        self.parameters = {}
        self.n = 0
        self.n_success = 0

        self.occurences: list[dict] = []

    def weighted(self, factor: float = 1.0) -> float:
        copy = Tool(self.name)
        copy.n = self.n * factor
        copy.n_success = self.n_success * factor
        copy.occurences = self.occurences.copy()
        copy.parameters = self.parameters.copy()
        return copy

    def add_occurence(self, trace_id: str, event_index: int):
        # self.occurences.append(
        #     {
        #         "trace_id": trace_id,
        #         "event_index": event_index,
        #     }
        # )
        pass

    def increment(self):
        self.n += 1

    def increment_success(self):
        self.n_success += 1

    def update_parameters_based_on_arguments(self, arguments: dict):
        if not isinstance(arguments, dict):
            raise ValueError("Arguments must be a dictionary.")
        for key, value in arguments.items():
            value_type = infer_type(value)
            self.parameters.setdefault(key, value_type)
            self.parameters[key] = union(self.parameters[key], value_type)

    def merge_tool(self, other):
        if not isinstance(other, Tool):
            raise ValueError("Can only merge with another Tool instance.")
        self.n += other.n
        self.n_success += other.n_success
        self.occurences.extend(other.occurences)

        for key, value in other.parameters.items():
            self.parameters.setdefault(key, value)
            self.parameters[key] = union(self.parameters[key], value)


class DerivedDataWorker:
    def __init__(self, dataset):
        self.dataset = dataset

        self.num_traces = 0
        # count per tool, the number of uses
        self.tools = dict()
        # allow processing of 10 traces in parallel at a time
        self.sempathor = asyncio.Semaphore(10)
        # average number of events
        self.num_events = 0
        # average number of tool calls
        self.num_tool_calls = 0
        # tool transition graph
        self.tool_graph = ToolTransitionGraphBuilder()

        # has success metadata
        self.has_success = False

    async def process_trace(self, trace: Trace):
        self.num_traces += 1

        # process trace metadata
        trace_has_success = False
        if "success" in trace.extra_metadata:
            self.has_success = True
            trace_has_success = trace.extra_metadata["success"]

        tools = {}

        self.tool_graph.add_trace(trace)

        # process trace events
        for i, event in enumerate(trace.content):
            tool_calls = event.get("tool_calls", [])
            for tool_call in tool_calls or []:
                function = tool_call.get("function")
                if not function:
                    continue
                # get the tool name
                tool_name = function.get("name")
                if not tool_name:
                    continue

                # add the tool name to the set
                tools.setdefault(tool_name, Tool(tool_name))
                tools[tool_name].increment()

                # also count 'success' for this trace
                if trace_has_success:
                    tools[tool_name].increment_success()

                # add the trace id and event index to the tool
                tools[tool_name].add_occurence(trace.id, i)

                # get the arguments
                arguments = function.get("arguments")
                if not arguments:
                    continue
                # update tool signatures if present
                tools[tool_name].update_parameters_based_on_arguments(arguments)

        # merge weighted tool information back into self.tools
        for tool_name, tool in tools.items():
            if tool_name not in self.tools:
                self.tools[tool_name] = tool.weighted(1.0 / len(trace.content))
            else:
                self.tools[tool_name].merge_tool(
                    tool.weighted(1.0 / len(trace.content))
                )

        # calculate the average number of events
        self.num_events += len(trace.content)
        # calculate the average number of tool calls

    async def result(self):
        return {
            "name": self.dataset.name,
            "num_traces": self.num_traces,
            "tools": self.tools,
            "tool_graph": self.tool_graph.export(),
            "average_num_events": self.num_events / self.num_traces
            if self.num_traces > 0
            else 0,
            "average_num_tool_calls": self.num_tool_calls / self.num_traces
            if self.num_traces > 0
            else 0,
        }

    async def run(self, session: Session):
        traces = session.query(Trace).filter(Trace.dataset_id == self.dataset.id).all()

        async def processor(trace):
            async with self.sempathor:
                await self.process_trace(trace)

        tasks = [asyncio.create_task(processor(trace)) for trace in traces]
        await asyncio.gather(*tasks)

        # check for exceptions and handle them
        for task in tasks:
            if task.exception():
                print(f"Task failed: {task.exception()}")
                raise HTTPException(status_code=500, detail="Internal server error")

        # return the result
        return await self.result()


@router.get("/byuser/{username}/{dataset_name}/derived")
async def get_derived_data(
    request: Request,
    username: str,
    dataset_name: str,
    user_id: Annotated[UUID, Depends(AuthenticatedUserIdentity)],
):
    """Compute the derived data for a dataset."""
    # Check if the user has access to the dataset
    with Session(db()) as session:
        try:
            dataset, user = load_dataset(
                session,
                {"name": dataset_name, "user_id": user_id},
                user_id,
                allow_public=True,
                return_user=True,
            )

            return await DerivedDataWorker(dataset).run(session)

        except Exception as e:
            import traceback

            traceback.print_exc()
            raise HTTPException(status_code=500, detail="Internal server error")
