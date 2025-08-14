# Unknown Server Development Instructions

**ALWAYS follow these instructions first and fallback to search or context gathering only when information here is incomplete or found to be in error.**

## Project Overview
Unknown Server is a modern Express.js server with comprehensive built-in systems for scalable applications. Features include authentication & authorization, service mesh architecture, API versioning, CLI management tools, PM2 process management, worker threads, and extensive documentation generation.

## Bootstrap & Dependencies
**EXACT COMMANDS - Run in order:**
```bash
# Clone and setup (if fresh clone)
cp .env.example .env
# Edit .env with required values (see Environment Variables section)

# Install dependencies - NEVER CANCEL: Takes ~60 seconds with warnings
npm install  # Timeout: 120+ seconds

# Install PM2 globally for process management - Takes ~39 seconds  
npm install -g pm2  # Timeout: 60+ seconds
```

## Environment Variables (REQUIRED)
**CRITICAL**: Server WILL NOT START without these environment variables. Copy `.env.example` to `.env` and configure:

**Mandatory Variables:**
- `DB_HOST` - MySQL database host
- `DB_USER` - MySQL database user  
- `DB_NAME` - MySQL database name
- `DB_PASSWORD` - MySQL database password
- `VERSION` - Application version (e.g., "2.5.1")
- `JWT_SECRET` - JWT signing secret
- `APP_URL` - Application URL (e.g., "http://localhost:3000")

**Important**: Server requires MySQL database connection. Without it, server starts but crashes during database initialization (~2 seconds).

## Build & Run Commands

### Development Server
```bash
# Development with hot reload - NEVER CANCEL: Continuously runs
npm run dev  # Uses nodemon, auto-restarts on file changes
# Timeout: Set to unlimited for continuous development
```

### Production Server
```bash
# Basic production start - NEVER CANCEL: Takes ~2 seconds to start, fails without DB
npm start    # Timeout: 30+ seconds

# Cluster mode for multi-core - NEVER CANCEL: Starts 4 workers, each takes ~2 seconds
npm run cluster  # Timeout: 60+ seconds
```

### PM2 Process Management (RECOMMENDED)
```bash
# Start with PM2 - NEVER CANCEL: Takes ~1 second, very fast startup
npm run start:pm2      # Production environment
npm run start:pm2:dev  # Development environment
npm run start:pm2:prod # Production environment (explicit)
# Timeout: 30+ seconds

# Monitor PM2 processes
npm run monitor  # Opens PM2 monitoring dashboard

# Stop PM2 processes
npm run stop:pm2
```

**PM2 Notes**: Starts 4 worker processes automatically. Each worker attempts to connect to database and will restart on failure (up to 10 times).

## CLI Management Tools
```bash
# Interactive CLI (has known display issues - punycode warnings)
npm run cli

# Direct commands work better - examples:
node ./cli/cli.js --help                    # Show all commands
node ./cli/cli.js user --help              # User management commands
node ./cli/cli.js service --help           # Service management  
node ./cli/cli.js docs --help              # Documentation tools
node ./cli/cli.js auth --help              # Authentication commands

# Service commands (require running server):
node ./cli/cli.js service routes           # List API routes
node ./cli/cli.js service status           # Check service status
node ./cli/cli.js service metrics          # View service metrics

# User commands (require running server):
node ./cli/cli.js user list                # List all users
node ./cli/cli.js user create              # Create new user
node ./cli/cli.js user delete <id>         # Delete user
```

**CLI Notes**: 
- Interactive mode has display issues (undefined texts, punycode warnings)
- Direct command-line usage works reliably
- Most commands require server to be running and accessible

## Testing & Validation
**NO AUTOMATED TESTS**: Project has no test scripts defined. Package.json shows `npm test` but marked as "when implemented".

**Manual Validation Required**: After changes, validate by:
1. Start server: `npm start` or `npm run dev`
2. Test CLI commands: `node ./cli/cli.js service --help` 
3. Check server logs for errors
4. Verify environment variables are loaded correctly

**Known Issues** (see KNOWN_ISSUES.md):
- CLI display issues with punycode warnings
- Authentication system interaction errors  
- PM2 may show blank CMD screens on Windows
- Registration system not functioning properly

## Documentation Generation
```bash
# Documentation commands (require running server):
node ./cli/cli.js docs serve               # Open docs in browser
node ./cli/cli.js docs generate            # Generate API documentation  
node ./cli/cli.js docs export              # Export OpenAPI spec
```

**Note**: Documentation generation requires server to be running and accessible at http://localhost:3000.

## Project Structure Navigation
```
├── cli/                    # CLI management tools and commands
├── cluster.js             # Multi-core clustering entry point
├── config/                 # Configuration files (nginx.conf, swagger.js)
├── database/              # Database connection and queries
│   ├── db.js              # MySQL connection handling
│   └── mainQueries.js     # Database initialization queries
├── docs/                  # Comprehensive documentation
│   ├── api.md             # API overview and versions
│   ├── authentication.md  # Auth guide
│   ├── deployment.md      # Deployment instructions
│   ├── getting-started.md # Quick start guide
│   └── versions/          # Version-specific API docs
├── ecosystem.config.js    # PM2 process configuration
├── logs/                  # Application logs (auto-created)
├── managers/              # Core functionality managers
│   ├── AuthManager.js     # Authentication system
│   ├── LogManager.js      # Logging system
│   ├── ServiceMeshManager.js # Service mesh
│   └── utils/             # Utility managers
├── public/                # Static assets
├── routers/               # Express route handlers  
├── server.js             # Main server entry point
└── views/                # EJS view templates
```

## Key Components & Frequently Modified Files
- **server.js**: Main application entry point, middleware setup
- **managers/**: Core business logic - modify these for feature changes
- **routers/**: API endpoint definitions and handlers
- **cli/commands/**: CLI command implementations
- **docs/**: Keep documentation updated with changes
- **ecosystem.config.js**: PM2 configuration for deployment

## Common Development Workflows

### Making Server Changes:
1. Edit relevant files in `managers/` or `routers/`
2. Test with: `npm run dev` (auto-restarts on changes)
3. Validate with CLI: `node ./cli/cli.js service status`

### Adding New CLI Commands:
1. Add command files to `cli/commands/`
2. Update `cli/cli.js` to register new commands
3. Test with: `node ./cli/cli.js <new-command> --help`

### API Development:
1. Add routes in `routers/`
2. Update documentation in `docs/versions/v1.md`
3. Test API endpoints manually or via CLI tools

## Deployment Considerations
- **Database Required**: MySQL database must be accessible
- **Environment Variables**: Complete .env configuration required
- **PM2 Recommended**: Use PM2 for production deployments
- **NGINX Proxy**: Designed to run behind NGINX reverse proxy
- **Scaling**: Supports clustering and PM2 multi-process deployment
- **Monitoring**: Built-in performance monitoring and health checks

## Troubleshooting Common Issues
1. **Server won't start**: Check environment variables in .env
2. **Database connection errors**: Verify MySQL is running and accessible
3. **CLI display issues**: Use direct commands instead of interactive mode
4. **PM2 process crashes**: Check logs with `pm2 logs --lines 50`
5. **Authentication errors**: Known issue, see KNOWN_ISSUES.md

## Development Best Practices
- Always use `npm run dev` for development (hot reloading)
- Test changes with multiple startup modes (dev, cluster, PM2)
- Update documentation when adding new features
- Use CLI tools to validate server functionality
- Monitor logs for errors and warnings during development
- Keep .env file updated with required variables

## Validation Scenarios
**ALWAYS test these scenarios after making changes:**

### Basic Server Validation:
```bash
# 1. Verify environment setup
cp .env.example .env  # Edit with required DB values

# 2. Test server startup (should fail gracefully without DB)
time npm start  # Should show warnings and exit with code 1 in ~2 seconds

# 3. Test CLI functionality 
node ./cli/cli.js --help              # Should show help without errors
node ./cli/cli.js user --help         # Should show user commands
```

### Complete System Validation:
```bash
# 4. Test PM2 startup
time npm run start:pm2  # Should start 4 workers in <1 second
pm2 logs --lines 10     # Should show database connection attempts
pm2 delete all          # Cleanup

# 5. Test development mode (requires manual stop)
npm run dev  # Should start with nodemon, auto-restart on file changes
```

**Expected Results:**
- All commands should execute without Node.js errors
- Server attempts database connection and fails gracefully  
- CLI help commands work correctly
- PM2 starts processes but they restart due to database failures

## Performance Expectations & Timeouts
- **Dependencies Install**: ~60 seconds (first time) - **Timeout: 120+ seconds**
- **PM2 Install**: ~39 seconds (global install) - **Timeout: 60+ seconds**
- **Server Startup**: ~2 seconds (fails without database) - **Timeout: 30+ seconds**
- **PM2 Startup**: ~0.7 seconds (very fast) - **Timeout: 30+ seconds**
- **Cluster Startup**: ~8 seconds (4 workers × ~2 seconds each) - **Timeout: 60+ seconds**

**CRITICAL**: NEVER CANCEL long-running operations. Set appropriate timeouts and wait for completion.