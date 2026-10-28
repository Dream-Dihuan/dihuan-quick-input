# Tasks

## 1. Configuration Model and Migration

- [x] 1.1 Extend shared configuration schemas and types with folder nodes (`id`, `name`, `parentId`) and optional mapping `folderId`; verify schema tests cover valid root/nested nodes, invalid names, duplicate IDs, and sibling-name conflicts.
- [x] 1.2 Add versioned migration for legacy flat alias configurations, defaulting missing folders and folder IDs to the root; verify legacy fixtures preserve every mapping and command behavior.
- [x] 1.3 Extend salvage/recovery logic to detect missing references, duplicate folder IDs, and parent cycles, relocating affected mappings/nodes safely and emitting warnings; verify malformed configuration tests pass.

## 2. Folder and Mapping Domain Operations

- [x] 2.1 Implement validated folder tree operations for create, rename, move, and empty-folder deletion; verify tests cover arbitrary nesting, same-level name uniqueness, cycle prevention, and stable IDs.
- [x] 2.2 Implement safe non-empty-folder deletion that requires explicit content relocation to the parent/root and performs the relocation atomically; verify contents are never silently discarded.
- [x] 2.3 Update mapping create/update/move operations to maintain `folderId` while preserving global command-name uniqueness and command lookup semantics; verify cross-folder duplicate names are rejected and registry tests remain green.
- [x] 2.4 Add a tree snapshot/read model that groups folders and mappings by parent without changing the flat command registry input; verify snapshot ordering and root-level mappings.

## 3. IPC and Renderer Settings UI

- [x] 3.1 Extend shared IPC contracts, preload exposure, request validation, and settings handlers for tree reads and folder CRUD/move operations; verify invalid payloads and authorization/error responses through IPC tests.
- [x] 3.2 Replace the flat alias table with an expandable/collapsible tree that displays named folders and mappings, retains selection state, and supports adding a mapping in the selected folder; verify component tests cover nested rendering and refresh behavior.
- [x] 3.3 Add folder create and rename forms with validation feedback, sibling-conflict handling, and refresh after successful persistence; verify UI tests cover empty and duplicate names.
- [x] 3.4 Add folder/mapping move actions and safe non-empty-folder deletion confirmation; verify UI tests demonstrate no silent data loss and correct post-operation tree state.
- [x] 3.5 Preserve existing mapping edit, enable/disable, delete, conflict display, and built-in-command help in the new tree layout; verify existing settings regression tests pass.

## 4. Integration Verification and Documentation

- [x] 4.1 Run the full typecheck, lint, unit, IPC, migration, and renderer test suites; verify all project checks pass with legacy and deeply nested fixtures.
- [x] 4.2 Document the folder model, root-level behavior, command lookup invariants, and safe deletion semantics in the relevant project documentation; verify examples match the implemented settings workflow.
