# How Memev compares

Part of the [Memev documentation](README.md). Up: the [README](../README.md).

Memev is operating infrastructure for human and AI work. It connects people, agents and tools
through shared project state, coordination, governed execution, contracts and evidence-based
verification. The local vault is the durable state substrate. This page compares that model with
hosted context services and distinguishes current Free Core capabilities from planned team and
multi-computer services.

## The approach

| Question | Memev | A typical hosted context service |
|---|---|---|
| Product model | Local operating infrastructure for shared state, coordination and governed work | Usually context storage and retrieval |
| Durable state | Inspectable local records, project state and provenance | Usually vendor-managed context records |
| Work governance | Contracts, task lifecycle, evidence and verification are distinct | Usually delegated to the AI app or external project system |
| Coordination | Connected AI-tool seats and a local communications bus | Provider-specific collaboration features, if any |
| How tools connect | MCP and supported hooks, using open integration points | Usually a proprietary API or connector |
| Operator control | Local-first; optional remote connectors and backup are configured deliberately | Data and availability depend on the vendor's service |
| Multi-computer editing | Not part of the Free Core; paid convergence and federation remain separate planned capabilities | Depends on the service |

The local vault keeps records inspectable and portable. The ProjectStore and Coordinator maintain
local project state and task lifecycle; contracts describe obligations; evidence supports
verification; and the communications bus coordinates connected tools. GitHub backup is optional
and remains under the operator's control. These are capabilities around work, not a claim that
Memev replaces the AI tools or project systems people already use.

## Sources

- Model Context Protocol, the open standard Memev uses to connect supported apps:
  https://modelcontextprotocol.io
- GitHub private repositories, where Memev stores your backup under your own account:
  https://docs.github.com/en/repositories/creating-and-managing-repositories/about-repositories
- CommonMark, the plain-text Markdown format used for portable records:
  https://commonmark.org

The "typical hosted context service" column describes the common cloud-hosted pattern rather than
any single product. Check each product's own documentation for its current terms.
