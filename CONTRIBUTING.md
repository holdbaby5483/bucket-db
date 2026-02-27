# Contributing to BucketDB

Thank you for your interest in contributing to BucketDB! This guide will help you get started.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Code Style](#code-style)
- [Submitting Changes](#submitting-changes)
- [Release Process](#release-process)

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). By participating, you are expected to uphold this code.

---

## Getting Started

### Prerequisites

- **Bun** v1.0+ ([installation guide](https://bun.sh/docs/installation))
- **Git**
- **Node.js** v18+ (for tooling compatibility)

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/bucket-db.git
   cd bucket-db
   ```
3. Add upstream remote:
   ```bash
   git remote add upstream https://github.com/original/bucket-db.git
   ```

---

## Development Setup

### Install Dependencies

```bash
bun install
```

### Build All Packages

```bash
bun run build
```

### Run Tests

```bash
bun test
```

### Run Examples

```bash
# Basic usage example
bun run examples/basic-usage/index.ts

# Local storage example
bun run examples/local-storage/index.ts

# Multi-database example
bun run examples/dbpath-demo/index.ts
```

---

## Project Structure

```
bucket-db/
├── packages/
│   ├── core/                 # Core database engine
│   │   ├── src/
│   │   │   ├── core/        # BucketDB, Collection
│   │   │   ├── storage/     # Storage adapters
│   │   │   ├── index/       # Shard management
│   │   │   ├── query/       # Query evaluation
│   │   │   └── utils/       # Hash utilities
│   │   └── tests/           # Test files
│   └── types/               # TypeScript type definitions
├── examples/                # Example projects
├── docs/                    # Documentation
│   ├── API.md              # API reference
│   └── plans/              # Design and implementation docs
├── package.json            # Root workspace config
└── bunfig.toml            # Bun configuration
```

### Key Files

- `packages/core/src/index.ts` - Main export file
- `packages/types/src/index.ts` - Type definitions
- `packages/core/tests/` - All test files

---

## Development Workflow

### 1. Create a Feature Branch

```bash
git checkout -b feature/your-feature-name
```

### 2. Make Your Changes

Follow the [TDD approach](#test-driven-development):
1. Write failing tests
2. Implement feature
3. Verify tests pass
4. Refactor if needed

### 3. Test Your Changes

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/core/collection.test.ts

# Watch mode
bun test --watch
```

### 4. Build and Verify

```bash
# Build packages
bun run build

# Run examples to verify
bun run examples/basic-usage/index.ts
```

### 5. Commit Your Changes

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```bash
# Format: <type>: <description>
# Types: feat, fix, docs, refactor, test, chore, perf

git commit -m "feat: add new query operator"
git commit -m "fix: resolve concurrent update issue"
git commit -m "docs: update API documentation"
```

---

## Testing

### Test-Driven Development

BucketDB follows TDD principles:

1. **Write failing test** - Define expected behavior
2. **Implement feature** - Make test pass
3. **Refactor** - Improve code quality
4. **Verify** - Ensure all tests still pass

### Test Structure

```typescript
import { describe, test, expect, beforeEach } from 'bun:test';

describe('FeatureName', () => {
  beforeEach(() => {
    // Setup
  });

  test('should do something', async () => {
    // Arrange
    const input = /* ... */;

    // Act
    const result = await functionUnderTest(input);

    // Assert
    expect(result).toBe(expected);
  });
});
```

### Test Coverage Guidelines

- **Core functionality**: 100% coverage
- **Storage adapters**: Test all CRUD operations
- **Query engine**: Test all operators
- **Error handling**: Test error cases

### Running Tests

```bash
# All tests
bun test

# Specific file
bun test tests/core/collection.test.ts

# Pattern matching
bun test storage

# Watch mode
bun test --watch
```

---

## Code Style

### TypeScript Guidelines

- **Strict mode**: All code must pass TypeScript strict checks
- **Type safety**: Avoid `any`, use proper types
- **Interfaces**: Use interfaces for public APIs
- **JSDoc**: Document public methods and classes

### Naming Conventions

- **Files**: kebab-case (e.g., `shard-manager.ts`)
- **Classes**: PascalCase (e.g., `ShardManager`)
- **Functions/Methods**: camelCase (e.g., `evaluateFilter`)
- **Interfaces**: PascalCase with `I` prefix for implementations (e.g., `ICollection`)
- **Types**: PascalCase (e.g., `QueryFilter`)

### Code Organization

```typescript
// 1. Imports
import type { StorageAdapter } from '@bucket-db/types';
import { StorageError } from '@bucket-db/types';

// 2. Type definitions
interface Config {
  // ...
}

// 3. Class/function implementation
export class MyClass {
  // Private fields first
  private field: string;

  // Constructor
  constructor(config: Config) {
    // ...
  }

  // Public methods
  public async method(): Promise<void> {
    // ...
  }

  // Private methods
  private helper(): void {
    // ...
  }
}
```

### Documentation

- **JSDoc**: Document all exported functions/classes
- **Examples**: Include usage examples in docs
- **Comments**: Explain "why", not "what"

```typescript
/**
 * Evaluates a query filter against a document
 *
 * @param document - The document to evaluate
 * @param filter - The query filter to apply
 * @returns true if document matches filter
 */
export function evaluateFilter<T>(
  document: T,
  filter: QueryFilter<T>
): boolean {
  // Implementation
}
```

---

## Submitting Changes

### Pull Request Process

1. **Update documentation** if needed
2. **Add tests** for new features
3. **Ensure all tests pass**: `bun test`
4. **Build successfully**: `bun run build`
5. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```
6. **Create Pull Request** on GitHub

### Pull Request Guidelines

- **Title**: Follow conventional commits format
- **Description**: Explain what and why
- **Link issues**: Reference related issues
- **Small PRs**: Keep changes focused

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] All tests pass
- [ ] Added new tests
- [ ] Updated documentation

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex logic
- [ ] Documentation updated
- [ ] No breaking changes (or documented)
```

---

## Release Process

Releases are managed by maintainers.

### Version Numbering

BucketDB follows [Semantic Versioning](https://semver.org/):

- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes

### Release Checklist

1. Update version in `package.json` files
2. Update CHANGELOG.md
3. Run full test suite
4. Build all packages
5. Create git tag
6. Publish to NPM
7. Create GitHub release

---

## Areas for Contribution

### High Priority

- [ ] Performance benchmarks and optimization
- [ ] Additional query operators ($exists, $regex, etc.)
- [ ] Sorting support
- [ ] Batch operations (insertBatch, updateBatch, deleteBatch)
- [ ] Count aggregation

### Medium Priority

- [ ] More storage adapters (Google Cloud Storage, Azure Blob, etc.)
- [ ] CLI tools for data import/export
- [ ] Migration utilities
- [ ] Enhanced error messages

### Documentation

- [ ] Tutorial videos
- [ ] More examples
- [ ] Performance tuning guide
- [ ] Migration guides from other databases

### Testing

- [ ] Integration tests with real cloud services
- [ ] Performance benchmarks
- [ ] Stress testing
- [ ] Load testing scripts

---

## Getting Help

- **GitHub Issues**: Bug reports and feature requests
- **Discussions**: Questions and community support
- **Email**: For security issues only

---

## Recognition

Contributors are recognized in:
- CHANGELOG.md (for each release)
- README.md (contributors section)
- Git commit history

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
