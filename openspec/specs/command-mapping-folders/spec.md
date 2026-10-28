# command-mapping-folders Specification

## Purpose

让用户能够用可命名、可嵌套的文件夹树组织大量命令映射，同时保持命令执行仍以命令名为入口，不因设置界面的分类方式改变调用习惯。

## Requirements

### Requirement: Folder hierarchy supports named nested folders

The system SHALL maintain a tree of named command-mapping folders, where each folder has a stable identifier and may contain child folders without a fixed nesting depth.

#### Scenario: Create a named root folder

- **WHEN** the user creates a folder with a valid name at the root level
- **THEN** the folder is persisted with a stable identifier and appears as a root node

#### Scenario: Create a nested folder

- **WHEN** the user creates a folder under an existing folder
- **THEN** the new folder appears as a child of that parent and retains the full hierarchy after reload

#### Scenario: Reject invalid folder name

- **WHEN** the user submits an empty, whitespace-only, or otherwise invalid folder name
- **THEN** the system rejects the operation and reports a validation error without changing the tree

### Requirement: Users can manage folder names and placement

The system SHALL allow users to rename folders and move folders to another valid parent while preventing cycles and duplicate sibling names.

#### Scenario: Rename a folder

- **WHEN** the user changes a folder name to a valid non-conflicting name
- **THEN** the folder keeps its identifier, displays the new name, and its children and mappings remain attached

#### Scenario: Move a folder

- **WHEN** the user moves a folder beneath a different valid parent
- **THEN** the folder and its entire subtree appear beneath the new parent after persistence

#### Scenario: Prevent a hierarchy cycle

- **WHEN** the user attempts to move a folder into itself or one of its descendants
- **THEN** the system rejects the move and leaves the hierarchy unchanged

### Requirement: Command mappings belong to folders without changing command lookup

The system SHALL allow each command mapping to be assigned to the root level or one folder, while command lookup and command-name uniqueness remain global and independent of folder placement.

#### Scenario: Add mapping in a selected folder

- **WHEN** the user creates a mapping while a folder is selected
- **THEN** the mapping is saved under that folder and remains executable by its command name

#### Scenario: Move mapping between folders

- **WHEN** the user moves an existing mapping to another folder or the root level
- **THEN** only its organization changes; its command, value, enabled state, and lookup behavior remain unchanged

#### Scenario: Duplicate command remains rejected across folders

- **WHEN** the user creates or renames a mapping to a command name already used anywhere in the tree
- **THEN** the system rejects the operation regardless of folder location

### Requirement: Tree view supports safe folder deletion

The system SHALL display folders and mappings in an expandable tree and SHALL prevent accidental loss when deleting a non-empty folder.

#### Scenario: Expand and collapse folders

- **WHEN** the user toggles a folder node
- **THEN** its descendants are shown or hidden without changing persisted data

#### Scenario: Delete an empty folder

- **WHEN** the user confirms deletion of a folder with no child folders or mappings
- **THEN** the folder is removed from the tree and persistence

#### Scenario: Delete a non-empty folder

- **WHEN** the user requests deletion of a folder containing descendants or mappings
- **THEN** the system requires an explicit safe handling choice (such as moving contents to the parent/root) or rejects deletion, and MUST NOT silently discard contents

### Requirement: Existing flat configurations remain compatible

The system SHALL load existing configurations that contain command mappings without folder metadata and preserve those mappings at the root level.

#### Scenario: Load legacy mappings

- **WHEN** the application loads a valid pre-folder configuration
- **THEN** all existing mappings remain available at the root, retain their identifiers and behavior, and the configuration is upgraded for future folder operations

#### Scenario: Recover malformed folder data

- **WHEN** folder metadata is invalid, cyclic, or references missing nodes
- **THEN** the system salvages valid mappings and folders, reports a warning, and places affected mappings at the root rather than silently losing them