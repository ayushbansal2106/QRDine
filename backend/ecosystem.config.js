/**
 * QRDine — PM2 Production Process Management Configuration (Task 7.7 / OPS-102)
 *
 * Provides:
 *  - Clustered worker execution across all CPU cores
 *  - Zero-downtime rolling reload (pm2 reload ecosystem.config.js)
 *  - Automatic crash recovery and memory leak threshold restart (512MB)
 *  - Merged structured logging with ISO timestamps
 */

module.exports = {
  apps: [
    {
      name: 'qrdine-backend',
      script: 'src/server.js',
      instances: 'max',
      exec_mode: 'cluster',
      max_memory_restart: '512M',
      wait_ready: true,
      listen_timeout: 10000,
      kill_timeout: 5000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      merge_logs: true,
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};
