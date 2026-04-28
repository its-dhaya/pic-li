"use strict";

const fs = require("fs-extra");
const path = require("path");
const { execSync } = require("child_process");

/**
 * Generates a Spring Boot Maven project from templates.
 * Supports 5 templates:
 *   default      – minimal setup (health endpoint only)
 *   rest-api     – full CRUD with H2 in-memory DB
 *   mysql        – full CRUD wired to MySQL   (also accepts "rest-api-mysql")
 *   postgres     – full CRUD wired to PostgreSQL (also accepts "rest-api-postgres")
 *   microservice – Eureka + Config Client + Feign ready template
 */

// ════════════════════════════════════════════════════════════════════════════
// Java version detection
// Reads the installed JDK major version. Falls back to 17 (LTS) if java is
// not on PATH or the version string is unrecognisable.
// ════════════════════════════════════════════════════════════════════════════
function detectJavaVersion() {
  try {
    const out = execSync("java -version 2>&1", {
      encoding: "utf8",
      timeout: 5000,
    });
    // Matches: 'version "17.0.9"', 'version "11.0.22"', 'version "21"', 'version "1.8.0_xxx"'
    const m = out.match(/version "(?:1\.)?(\d+)/);
    if (m) {
      const major = parseInt(m[1], 10);
      if (major >= 21) return { version: 21, found: true };
      if (major >= 17) return { version: 17, found: true };
      if (major >= 11) return { version: 11, found: true };
      return { version: null, found: true, tooOld: true, detected: major };
    }
  } catch (_) {
    return { version: 17, found: false };
  }
  return { version: 17, found: true };
}

async function generate({ name, template, targetDir, onStep }) {
  // ── Normalize template aliases from stacks.js ──────────────────────────
  if (template === "rest-api-mysql") template = "mysql";
  if (template === "rest-api-postgres") template = "postgres";

  // ── Java version detection ─────────────────────────────────────────────
  onStep("Detecting installed Java version");
  const javaInfo = detectJavaVersion();
  let javaVersion = javaInfo.version ?? 17;
  let javaWarning = null;

  if (!javaInfo.found) {
    javaWarning =
      "Java was not found on your PATH.\n" +
      "Spring Boot 3.x requires Java 17 or later.\n" +
      "Download: https://adoptium.net/temurin/releases/?version=17\n" +
      "After installing, re-run: pic run";
  } else if (javaInfo.tooOld) {
    javaWarning =
      `Java ${javaInfo.detected} detected — Spring Boot 3.x requires Java 17+.\n` +
      "Download Java 17 LTS: https://adoptium.net/temurin/releases/?version=17\n" +
      "After installing, re-run: pic run";
    javaVersion = 17;
  } else {
    onStep(`Java ${javaVersion} detected — using as compile target`);
  }

  const artifact = name.toLowerCase().replace(/[\s_]/g, "-");
  const pkg = "com.example";
  const pkgSuffix = artifact.replace(/-/g, "");
  const fullPkg = `${pkg}.${pkgSuffix}`;
  const className = toPascal(artifact);
  // Database name derived from artifact — shown prominently in README + startup log
  const dbName = artifact.replace(/-/g, "_") + "_db";

  // ── Directory skeleton ───────────────────────────────────────────────────
  onStep("Creating Maven directory structure");
  const mainJava = path.join(
    targetDir,
    "src",
    "main",
    "java",
    ...pkg.split("."),
    pkgSuffix
  );
  const testJava = path.join(
    targetDir,
    "src",
    "test",
    "java",
    ...pkg.split("."),
    pkgSuffix
  );
  const resources = path.join(targetDir, "src", "main", "resources");

  ["controller", "service", "model", "repository", "exception", "dto"].forEach(
    (d) => fs.ensureDirSync(path.join(mainJava, d))
  );
  fs.ensureDirSync(testJava);
  fs.ensureDirSync(resources);

  // ── pom.xml ──────────────────────────────────────────────────────────────
  onStep("Writing pom.xml");
  fs.writeFileSync(
    path.join(targetDir, "pom.xml"),
    pomXml(artifact, pkg, template, javaVersion)
  );

  // ── Main application class ───────────────────────────────────────────────
  onStep("Writing Application.java");
  fs.writeFileSync(
    path.join(mainJava, `${className}Application.java`),
    applicationClass(fullPkg, className, template)
  );

  // ── application.properties ───────────────────────────────────────────────
  onStep("Writing application.properties");
  fs.writeFileSync(
    path.join(resources, "application.properties"),
    appProperties(artifact, template)
  );

  // ── Template-specific source files ───────────────────────────────────────
  if (template === "default") {
    onStep("Writing HealthController");
    fs.writeFileSync(
      path.join(mainJava, "controller", "HealthController.java"),
      healthController(fullPkg)
    );
  }

  if (["rest-api", "mysql", "postgres"].includes(template)) {
    onStep("Writing Item model");
    fs.writeFileSync(
      path.join(mainJava, "model", "Item.java"),
      itemModel(fullPkg)
    );

    onStep("Writing ItemDto");
    fs.writeFileSync(
      path.join(mainJava, "dto", "ItemDto.java"),
      itemDto(fullPkg)
    );

    onStep("Writing ItemRepository");
    fs.writeFileSync(
      path.join(mainJava, "repository", "ItemRepository.java"),
      itemRepository(fullPkg)
    );

    onStep("Writing ItemService interface");
    fs.writeFileSync(
      path.join(mainJava, "service", "ItemService.java"),
      itemService(fullPkg)
    );

    onStep("Writing ItemServiceImpl");
    fs.writeFileSync(
      path.join(mainJava, "service", "ItemServiceImpl.java"),
      itemServiceImpl(fullPkg)
    );

    onStep("Writing ItemController");
    fs.writeFileSync(
      path.join(mainJava, "controller", "ItemController.java"),
      itemController(fullPkg)
    );

    onStep("Writing ResourceNotFoundException");
    fs.writeFileSync(
      path.join(mainJava, "exception", "ResourceNotFoundException.java"),
      resourceNotFoundException(fullPkg)
    );

    onStep("Writing GlobalExceptionHandler");
    fs.writeFileSync(
      path.join(mainJava, "exception", "GlobalExceptionHandler.java"),
      globalExceptionHandler(fullPkg)
    );

    // For mysql/postgres: generate a startup banner that prints the exact
    // database name the app will connect to, so users know what to create.
    if (template === "mysql" || template === "postgres") {
      onStep("Writing DatabaseStartupLogger");
      fs.ensureDirSync(path.join(mainJava, "config"));
      fs.writeFileSync(
        path.join(mainJava, "config", "DatabaseStartupLogger.java"),
        dbStartupLogger(fullPkg, dbName, template)
      );
    }

    // NOTE: schema.sql is intentionally NOT generated.
    // In Spring Boot 3.x, any schema.sql on the classpath activates the SQL
    // initializer, which conflicts with Hibernate's DDL (create-drop / update)
    // and crashes the ApplicationContext on startup.
    // Hibernate ddl-auto is the sole owner of schema lifecycle here.
  }

  if (template === "microservice") {
    onStep("Writing ServiceConfig");
    fs.ensureDirSync(path.join(mainJava, "config"));
    fs.writeFileSync(
      path.join(mainJava, "config", "ServiceConfig.java"),
      serviceConfig(fullPkg)
    );

    onStep("Writing Feign client + fallback");
    fs.ensureDirSync(path.join(mainJava, "client"));
    fs.writeFileSync(
      path.join(mainJava, "client", "SampleFeignClient.java"),
      feignClient(fullPkg)
    );
    fs.writeFileSync(
      path.join(mainJava, "client", "SampleFeignClientFallback.java"),
      feignClientFallback(fullPkg)
    );

    onStep("Writing ServiceController");
    fs.writeFileSync(
      path.join(mainJava, "controller", "ServiceController.java"),
      microserviceController(fullPkg, artifact)
    );

    onStep("Writing Docker files");
    fs.writeFileSync(
      path.join(targetDir, "Dockerfile"),
      dockerfile(artifact, javaVersion)
    );
    fs.writeFileSync(
      path.join(targetDir, "docker-compose.yml"),
      dockerCompose(artifact)
    );
  }

  // ── Test class ───────────────────────────────────────────────────────────
  onStep("Writing test class");
  fs.writeFileSync(
    path.join(testJava, `${className}ApplicationTests.java`),
    testClass(fullPkg, className, template)
  );

  // ── Maven wrapper placeholder ────────────────────────────────────────────
  onStep("Writing .mvn wrapper");
  fs.ensureDirSync(path.join(targetDir, ".mvn", "wrapper"));
  fs.writeFileSync(
    path.join(targetDir, ".mvn", "wrapper", "maven-wrapper.properties"),
    `distributionUrl=https://repo.maven.apache.org/maven2/org/apache/maven/apache-maven/3.9.6/apache-maven-3.9.6-bin.zip\n`
  );

  // ── Git ──────────────────────────────────────────────────────────────────
  onStep("Initializing Git");
  try {
    const { runSilent } = require("../../core/runCommand");
    await runSilent("git init", { cwd: targetDir });
  } catch (_) {}
  fs.writeFileSync(path.join(targetDir, ".gitignore"), gitignore());

  // ── README ───────────────────────────────────────────────────────────────
  onStep("Writing README");
  fs.writeFileSync(
    path.join(targetDir, "README.md"),
    readme(name, artifact, dbName, template, javaVersion, javaWarning)
  );

  // ── Surface Java warning after generation ─────────────────────────────
  if (javaWarning) {
    onStep("\n⚠  " + javaWarning);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// pom.xml
// java.version is injected dynamically from detectJavaVersion().
// ════════════════════════════════════════════════════════════════════════════
function pomXml(artifact, pkg, template, javaVersion) {
  const isDb = ["mysql", "postgres", "rest-api"].includes(template);
  const isMysql = template === "mysql";
  const isPostgres = template === "postgres";
  const isH2 = template === "rest-api";
  const isMicro = template === "microservice";

  const springBootVersion = "3.2.3";
  const springCloudVersion = "2023.0.1";

  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0
         https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>${springBootVersion}</version>
    <relativePath/>
  </parent>

  <groupId>${pkg}</groupId>
  <artifactId>${artifact}</artifactId>
  <version>0.0.1-SNAPSHOT</version>
  <name>${artifact}</name>
  <description>Generated by PIC-LI</description>

  <properties>
    <!-- Auto-detected from installed JDK at project generation time -->
    <java.version>${javaVersion}</java.version>${
    isMicro
      ? `\n    <spring-cloud.version>${springCloudVersion}</spring-cloud.version>`
      : ""
  }
  </properties>

  <dependencies>
    <!-- Web -->
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>

    <!-- Actuator -->
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-actuator</artifactId>
    </dependency>

    <!-- Validation -->
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-validation</artifactId>
    </dependency>
${
  isDb
    ? `
    <!-- JPA -->
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-data-jpa</artifactId>
    </dependency>
`
    : ""
}${
    isH2
      ? `
    <!-- H2 in-memory database (dev/test) -->
    <dependency>
      <groupId>com.h2database</groupId>
      <artifactId>h2</artifactId>
      <scope>runtime</scope>
    </dependency>
`
      : ""
  }${
    isMysql
      ? `
    <!-- MySQL connector -->
    <dependency>
      <groupId>com.mysql</groupId>
      <artifactId>mysql-connector-j</artifactId>
      <scope>runtime</scope>
    </dependency>
`
      : ""
  }${
    isPostgres
      ? `
    <!-- PostgreSQL driver -->
    <dependency>
      <groupId>org.postgresql</groupId>
      <artifactId>postgresql</artifactId>
      <scope>runtime</scope>
    </dependency>
`
      : ""
  }${
    isMicro
      ? `
    <!-- Spring Cloud Eureka Client (auto-configured — no @EnableEurekaClient needed) -->
    <dependency>
      <groupId>org.springframework.cloud</groupId>
      <artifactId>spring-cloud-starter-netflix-eureka-client</artifactId>
    </dependency>

    <!-- Spring Cloud Config Client -->
    <dependency>
      <groupId>org.springframework.cloud</groupId>
      <artifactId>spring-cloud-starter-config</artifactId>
    </dependency>

    <!-- OpenFeign -->
    <dependency>
      <groupId>org.springframework.cloud</groupId>
      <artifactId>spring-cloud-starter-openfeign</artifactId>
    </dependency>

    <!-- Resilience4j Circuit Breaker -->
    <dependency>
      <groupId>org.springframework.cloud</groupId>
      <artifactId>spring-cloud-starter-circuitbreaker-resilience4j</artifactId>
    </dependency>
`
      : ""
  }
    <!-- Test -->
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-test</artifactId>
      <scope>test</scope>
    </dependency>
  </dependencies>
${
  isMicro
    ? `
  <dependencyManagement>
    <dependencies>
      <dependency>
        <groupId>org.springframework.cloud</groupId>
        <artifactId>spring-cloud-dependencies</artifactId>
        <version>\${spring-cloud.version}</version>
        <type>pom</type>
        <scope>import</scope>
      </dependency>
    </dependencies>
  </dependencyManagement>
`
    : ""
}
  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
      </plugin>
    </plugins>
  </build>
</project>
`;
}

// ════════════════════════════════════════════════════════════════════════════
// Application.java
//
// @EnableEurekaClient was REMOVED in Spring Cloud 2022.x / 2023.0.x.
// Eureka is now fully auto-configured by the starter. Only @EnableFeignClients
// is kept — it is still required to activate Feign proxy generation.
// ════════════════════════════════════════════════════════════════════════════
function applicationClass(fullPkg, className, template) {
  const isMicro = template === "microservice";

  return `package ${fullPkg};

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;${
    isMicro
      ? "\nimport org.springframework.cloud.openfeign.EnableFeignClients;"
      : ""
  }

@SpringBootApplication${isMicro ? "\n@EnableFeignClients" : ""}
public class ${className}Application {
    public static void main(String[] args) {
        SpringApplication.run(${className}Application.class, args);
    }
}
`;
}

// ════════════════════════════════════════════════════════════════════════════
// application.properties
//
// ── H2 (rest-api) ────────────────────────────────────────────────────────────
//   Root cause of exit-code-1: Document 5 wrote a schema.sql file AND set
//   defer-datasource-initialization=true.  In Spring Boot 3.x, ANY file named
//   schema.sql on the classpath (even all-comments) activates the SQL
//   initializer.  Together with defer-datasource-initialization=true this
//   creates a double-DDL conflict that crashes the ApplicationContext.
//
//   Fix applied:
//     • schema.sql is never generated (see generate() above).
//     • spring.sql.init.mode=never  — explicitly disables the SQL runner so
//       even if a schema.sql appears later it cannot interfere.
//     • spring.jpa.defer-datasource-initialization removed — only needed when
//       SQL scripts must run AFTER Hibernate DDL; irrelevant here.
//     • spring.jpa.database-platform removed — Hibernate 6 (bundled in Spring
//       Boot 3.x) auto-detects the H2 dialect; explicit setting is ignored and
//       can cause a ClassNotFoundException if the class path changes.
//
// ── MySQL / PostgreSQL ────────────────────────────────────────────────────────
//   Root cause of exit-code-1: the DB name the app connects to is derived from
//   the Maven artifact ID  (artifact.replace(/-/g,"_") + "_db").
//   e.g.  project "spring-sql"  →  connects to  spring_sql_db
//         project "spring-post" →  connects to  spring_post_db
//   If the user creates a differently-named database the connection is refused
//   and Hikari times out → exit 1.
//
//   Fix applied:
//     • The required DB name is printed in the startup log by DatabaseStartupLogger.
//     • spring.sql.init.mode=never prevents the SQL runner from touching the DB.
//     • spring.jpa.properties.hibernate.dialect removed — Hibernate 6 auto-
//       detects the dialect; the old class paths (e.g. PostgreSQLDialect) moved
//       in Hibernate 6 and setting them explicitly causes a startup failure.
// ════════════════════════════════════════════════════════════════════════════
function appProperties(artifact, template) {
  const dbName = artifact.replace(/-/g, "_") + "_db";

  const base = `spring.application.name=${artifact}
server.port=8080

# Actuator
management.endpoints.web.exposure.include=health,info,metrics
management.endpoint.health.show-details=always
`;

  // ── H2 ──────────────────────────────────────────────────────────────────
  const h2 = `
# ── H2 In-Memory Database (dev/test) ────────────────────────────────────────
# Data is reset on every restart — use mysql/postgres template for persistence.
spring.datasource.url=jdbc:h2:mem:${dbName}
spring.datasource.driver-class-name=org.h2.Driver
spring.datasource.username=sa
spring.datasource.password=

# H2 web console  →  http://localhost:8080/h2-console
# JDBC URL to enter in the console: jdbc:h2:mem:${dbName}
spring.h2.console.enabled=true
spring.h2.console.path=/h2-console
spring.h2.console.settings.web-allow-others=false

# JPA / Hibernate 6 — dialect is auto-detected; no explicit setting needed
spring.jpa.hibernate.ddl-auto=create-drop
spring.jpa.show-sql=true
spring.jpa.open-in-view=false

# Disable Spring's SQL script runner — Hibernate owns the schema lifecycle
spring.sql.init.mode=never
`;

  // ── MySQL ────────────────────────────────────────────────────────────────
  const mysql = `
# ── MySQL ─────────────────────────────────────────────────────────────────────
# ┌─────────────────────────────────────────────────────────────────────────┐
# │  REQUIRED: create this database in MySQL before starting the app:       │
# │                                                                         │
# │    CREATE DATABASE ${dbName};                          │
# │                                                                         │
# │  The app will FAIL to start if this database does not exist.            │
# └─────────────────────────────────────────────────────────────────────────┘
spring.datasource.url=jdbc:mysql://localhost:3306/${dbName}?useSSL=false&serverTimezone=UTC&allowPublicKeyRetrieval=true
spring.datasource.username=root
spring.datasource.password=
spring.datasource.driver-class-name=com.mysql.cj.jdbc.Driver

# Hikari pool — fail fast (5 s) with a clear error if the DB is unreachable
spring.datasource.hikari.connection-timeout=5000
spring.datasource.hikari.initialization-fail-timeout=5000
spring.datasource.hikari.maximum-pool-size=5

# JPA / Hibernate 6 — dialect is auto-detected; no explicit setting needed
spring.jpa.hibernate.ddl-auto=update
spring.jpa.show-sql=true
spring.jpa.open-in-view=false
spring.sql.init.mode=never
`;

  // ── PostgreSQL ────────────────────────────────────────────────────────────
  const postgres = `
# ── PostgreSQL ─────────────────────────────────────────────────────────────
# ┌─────────────────────────────────────────────────────────────────────────┐
# │  REQUIRED: create this database in PostgreSQL before starting the app:  │
# │                                                                         │
# │    CREATE DATABASE ${dbName};                          │
# │                                                                         │
# │  The app will FAIL to start if this database does not exist.            │
# └─────────────────────────────────────────────────────────────────────────┘
spring.datasource.url=jdbc:postgresql://localhost:5432/${dbName}
spring.datasource.username=postgres
spring.datasource.password=

# Hikari pool — fail fast (5 s) with a clear error if the DB is unreachable
spring.datasource.hikari.connection-timeout=5000
spring.datasource.hikari.initialization-fail-timeout=5000
spring.datasource.hikari.maximum-pool-size=5

# JPA / Hibernate 6 — dialect is auto-detected; no explicit setting needed
spring.jpa.hibernate.ddl-auto=update
spring.jpa.show-sql=true
spring.jpa.open-in-view=false
spring.sql.init.mode=never
`;

  const micro = `
# ── Eureka (auto-configured — no @EnableEurekaClient annotation needed) ──────
eureka.client.service-url.defaultZone=http://localhost:8761/eureka/
eureka.instance.prefer-ip-address=true

# ── Config Server (optional) ─────────────────────────────────────────────────
spring.config.import=optional:configserver:http://localhost:8888

# ── Resilience4j Circuit Breaker ─────────────────────────────────────────────
resilience4j.circuitbreaker.instances.default.sliding-window-size=10
resilience4j.circuitbreaker.instances.default.failure-rate-threshold=50
resilience4j.circuitbreaker.instances.default.wait-duration-in-open-state=10s
resilience4j.circuitbreaker.instances.default.permitted-number-of-calls-in-half-open-state=3
`;

  if (template === "rest-api") return base + h2;
  if (template === "mysql") return base + mysql;
  if (template === "postgres") return base + postgres;
  if (template === "microservice") return base + micro;
  return base;
}

// ════════════════════════════════════════════════════════════════════════════
// DatabaseStartupLogger
// Prints the exact database name the app will connect to immediately on
// startup — before Hikari even tries to connect — so the user knows exactly
// what database to create if the connection fails.
// ════════════════════════════════════════════════════════════════════════════
function dbStartupLogger(fullPkg, dbName, template) {
  const dbType = template === "mysql" ? "MySQL" : "PostgreSQL";
  const port = template === "mysql" ? "3306" : "5432";
  const cmd =
    template === "mysql"
      ? `mysql -u root -p -e \\"CREATE DATABASE ${dbName};\\"`
      : `psql -U postgres -c \\"CREATE DATABASE ${dbName};\\"`;

  return `package ${fullPkg}.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationEnvironmentPreparedEvent;
import org.springframework.context.ApplicationListener;
import org.springframework.stereotype.Component;

/**
 * Prints the required database name before Hikari attempts the first
 * connection, so startup failures immediately show the correct fix.
 */
@Component
public class DatabaseStartupLogger
        implements ApplicationListener<ApplicationEnvironmentPreparedEvent> {

    private static final Logger log = LoggerFactory.getLogger(DatabaseStartupLogger.class);

    @Override
    public void onApplicationEvent(ApplicationEnvironmentPreparedEvent event) {
        log.info("=".repeat(72));
        log.info("  Database: ${dbType} on localhost:${port}");
        log.info("  Required DB name : ${dbName}");
        log.info("  Create with      : ${cmd}");
        log.info("=".repeat(72));
    }
}
`;
}

// ════════════════════════════════════════════════════════════════════════════
// DEFAULT template — HealthController
// ════════════════════════════════════════════════════════════════════════════
function healthController(fullPkg) {
  return `package ${fullPkg}.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.Map;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class HealthController {

    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        return ResponseEntity.ok(Map.of(
            "status",    "UP",
            "timestamp", Instant.now().toString()
        ));
    }

    @GetMapping("/hello")
    public ResponseEntity<Map<String, String>> hello(
            @RequestParam(defaultValue = "World") String name) {
        return ResponseEntity.ok(Map.of("message", "Hello, " + name + "!"));
    }
}
`;
}

// ════════════════════════════════════════════════════════════════════════════
// CRUD layer — shared by rest-api / mysql / postgres
// ════════════════════════════════════════════════════════════════════════════
function itemModel(fullPkg) {
  return `package ${fullPkg}.model;

import jakarta.persistence.*;
import jakarta.validation.constraints.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "items")
public class Item {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @NotBlank(message = "Name is required")
    @Size(min = 2, max = 100, message = "Name must be between 2 and 100 characters")
    @Column(nullable = false)
    private String name;

    @Column(length = 500)
    private String description;

    @NotNull(message = "Price is required")
    @DecimalMin(value = "0.0", inclusive = false, message = "Price must be positive")
    private Double price;

    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() { updatedAt = LocalDateTime.now(); }

    public Item() {}

    public Item(String name, String description, Double price) {
        this.name        = name;
        this.description = description;
        this.price       = price;
    }

    public Long   getId()                  { return id; }
    public void   setId(Long id)           { this.id = id; }
    public String getName()                { return name; }
    public void   setName(String name)     { this.name = name; }
    public String getDescription()         { return description; }
    public void   setDescription(String d) { this.description = d; }
    public Double getPrice()               { return price; }
    public void   setPrice(Double price)   { this.price = price; }
    public LocalDateTime getCreatedAt()    { return createdAt; }
    public LocalDateTime getUpdatedAt()    { return updatedAt; }
}
`;
}

function itemDto(fullPkg) {
  return `package ${fullPkg}.dto;

import jakarta.validation.constraints.*;

public class ItemDto {

    @NotBlank(message = "Name is required")
    @Size(min = 2, max = 100)
    private String name;

    private String description;

    @NotNull(message = "Price is required")
    @DecimalMin(value = "0.0", inclusive = false)
    private Double price;

    public ItemDto() {}

    public ItemDto(String name, String description, Double price) {
        this.name        = name;
        this.description = description;
        this.price       = price;
    }

    public String getName()                { return name; }
    public void   setName(String name)     { this.name = name; }
    public String getDescription()         { return description; }
    public void   setDescription(String d) { this.description = d; }
    public Double getPrice()               { return price; }
    public void   setPrice(Double price)   { this.price = price; }
}
`;
}

function itemRepository(fullPkg) {
  return `package ${fullPkg}.repository;

import ${fullPkg}.model.Item;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ItemRepository extends JpaRepository<Item, Long> {

    List<Item> findByNameContainingIgnoreCase(String name);

    List<Item> findByPriceLessThanEqual(Double maxPrice);

    @Query("SELECT i FROM Item i WHERE i.price BETWEEN :min AND :max")
    List<Item> findByPriceRange(@Param("min") Double min, @Param("max") Double max);
}
`;
}

function itemService(fullPkg) {
  return `package ${fullPkg}.service;

import ${fullPkg}.dto.ItemDto;
import ${fullPkg}.model.Item;

import java.util.List;

public interface ItemService {
    List<Item> findAll();
    Item       findById(Long id);
    Item       create(ItemDto dto);
    Item       update(Long id, ItemDto dto);
    void       delete(Long id);
    List<Item> search(String name);
}
`;
}

function itemServiceImpl(fullPkg) {
  return `package ${fullPkg}.service;

import ${fullPkg}.dto.ItemDto;
import ${fullPkg}.exception.ResourceNotFoundException;
import ${fullPkg}.model.Item;
import ${fullPkg}.repository.ItemRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@Transactional
public class ItemServiceImpl implements ItemService {

    private final ItemRepository repo;

    public ItemServiceImpl(ItemRepository repo) { this.repo = repo; }

    @Override @Transactional(readOnly = true)
    public List<Item> findAll() { return repo.findAll(); }

    @Override @Transactional(readOnly = true)
    public Item findById(Long id) {
        return repo.findById(id)
            .orElseThrow(() ->
                new ResourceNotFoundException("Item not found with id: " + id));
    }

    @Override
    public Item create(ItemDto dto) {
        return repo.save(new Item(dto.getName(), dto.getDescription(), dto.getPrice()));
    }

    @Override
    public Item update(Long id, ItemDto dto) {
        Item item = findById(id);
        item.setName(dto.getName());
        item.setDescription(dto.getDescription());
        item.setPrice(dto.getPrice());
        return repo.save(item);
    }

    @Override
    public void delete(Long id) { repo.delete(findById(id)); }

    @Override @Transactional(readOnly = true)
    public List<Item> search(String name) {
        return repo.findByNameContainingIgnoreCase(name);
    }
}
`;
}

function itemController(fullPkg) {
  return `package ${fullPkg}.controller;

import ${fullPkg}.dto.ItemDto;
import ${fullPkg}.model.Item;
import ${fullPkg}.service.ItemService;
import jakarta.validation.Valid;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/items")
@CrossOrigin(origins = "*")
public class ItemController {

    private final ItemService service;

    public ItemController(ItemService service) { this.service = service; }

    @GetMapping
    public ResponseEntity<List<Item>> getAll() {
        return ResponseEntity.ok(service.findAll());
    }

    @GetMapping("/{id}")
    public ResponseEntity<Item> getById(@PathVariable Long id) {
        return ResponseEntity.ok(service.findById(id));
    }

    @PostMapping
    public ResponseEntity<Item> create(@Valid @RequestBody ItemDto dto) {
        return ResponseEntity.status(HttpStatus.CREATED).body(service.create(dto));
    }

    @PutMapping("/{id}")
    public ResponseEntity<Item> update(@PathVariable Long id,
                                       @Valid @RequestBody ItemDto dto) {
        return ResponseEntity.ok(service.update(id, dto));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/search")
    public ResponseEntity<List<Item>> search(@RequestParam String name) {
        return ResponseEntity.ok(service.search(name));
    }
}
`;
}

function resourceNotFoundException(fullPkg) {
  return `package ${fullPkg}.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

@ResponseStatus(HttpStatus.NOT_FOUND)
public class ResourceNotFoundException extends RuntimeException {
    public ResourceNotFoundException(String message) { super(message); }
}
`;
}

function globalExceptionHandler(fullPkg) {
  return `package ${fullPkg}.exception;

import org.springframework.http.*;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.*;

@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<Map<String, Object>> handleNotFound(ResourceNotFoundException ex) {
        return buildError(HttpStatus.NOT_FOUND, ex.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, Object>> handleValidation(MethodArgumentNotValidException ex) {
        Map<String, String> fieldErrors = new LinkedHashMap<>();
        ex.getBindingResult().getAllErrors().forEach(err ->
            fieldErrors.put(((FieldError) err).getField(), err.getDefaultMessage())
        );
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", Instant.now().toString());
        body.put("status",    HttpStatus.BAD_REQUEST.value());
        body.put("errors",    fieldErrors);
        return ResponseEntity.badRequest().body(body);
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleGeneric(Exception ex) {
        return buildError(HttpStatus.INTERNAL_SERVER_ERROR, "An unexpected error occurred");
    }

    private ResponseEntity<Map<String, Object>> buildError(HttpStatus status, String message) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("timestamp", Instant.now().toString());
        body.put("status",    status.value());
        body.put("error",     status.getReasonPhrase());
        body.put("message",   message);
        return ResponseEntity.status(status).body(body);
    }
}
`;
}

// ════════════════════════════════════════════════════════════════════════════
// MICROSERVICE template
//
// Fix 1: @EnableEurekaClient removed — deleted from Spring Cloud 2022.x.
// Fix 2: SampleFeignClientFallback generated — was referenced but never created.
// ════════════════════════════════════════════════════════════════════════════
function serviceConfig(fullPkg) {
  return `package ${fullPkg}.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;

@Configuration
public class ServiceConfig {

    @Value("\${spring.application.name}")
    private String serviceName;

    @Value("\${server.port:8080}")
    private int serverPort;

    public String getServiceName() { return serviceName; }
    public int    getServerPort()  { return serverPort; }
}
`;
}

function feignClient(fullPkg) {
  return `package ${fullPkg}.client;

import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;

import java.util.Map;

/** Replace "other-service" with the spring.application.name of the target service. */
@FeignClient(name = "other-service", fallback = SampleFeignClientFallback.class)
public interface SampleFeignClient {

    @GetMapping("/api/health")
    Map<String, Object> getHealth();

    @GetMapping("/api/resource/{id}")
    Map<String, Object> getResource(@PathVariable Long id);
}
`;
}

function feignClientFallback(fullPkg) {
  return `package ${fullPkg}.client;

import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * Resilience4j fallback returned when "other-service" is unavailable.
 * Customise these responses to match your circuit-breaker strategy.
 */
@Component
public class SampleFeignClientFallback implements SampleFeignClient {

    @Override
    public Map<String, Object> getHealth() {
        return Map.of(
            "status", "DOWN",
            "reason", "other-service is currently unavailable"
        );
    }

    @Override
    public Map<String, Object> getResource(Long id) {
        return Map.of(
            "status", "DOWN",
            "reason", "other-service is currently unavailable",
            "id",     id
        );
    }
}
`;
}

function microserviceController(fullPkg, artifact) {
  return `package ${fullPkg}.controller;

import ${fullPkg}.client.SampleFeignClient;
import ${fullPkg}.config.ServiceConfig;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.Map;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class ServiceController {

    private final ServiceConfig     config;
    private final SampleFeignClient feignClient;

    public ServiceController(ServiceConfig config, SampleFeignClient feignClient) {
        this.config      = config;
        this.feignClient = feignClient;
    }

    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        return ResponseEntity.ok(Map.of(
            "status",  "UP",
            "service", config.getServiceName(),
            "port",    config.getServerPort(),
            "time",    Instant.now().toString()
        ));
    }

    @GetMapping("/info")
    public ResponseEntity<Map<String, Object>> info() {
        return ResponseEntity.ok(Map.of(
            "service",     config.getServiceName(),
            "description", "Microservice generated by PIC-LI",
            "version",     "0.0.1-SNAPSHOT"
        ));
    }

    /** Inter-service call via Feign — falls back automatically if target is down. */
    @GetMapping("/remote/health")
    public ResponseEntity<Map<String, Object>> remoteHealth() {
        return ResponseEntity.ok(feignClient.getHealth());
    }
}
`;
}

function dockerfile(artifact, javaVersion) {
  return `# ── Build stage ─────────────────────────────────────────────────────────────
FROM eclipse-temurin:${javaVersion}-jdk-alpine AS builder
WORKDIR /app
COPY .mvn/ .mvn/
COPY pom.xml .
RUN mvn dependency:go-offline -q || true
COPY src ./src
RUN mvn package -DskipTests -q

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM eclipse-temurin:${javaVersion}-jre-alpine
WORKDIR /app
COPY --from=builder /app/target/${artifact}-0.0.1-SNAPSHOT.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
`;
}

function dockerCompose(artifact) {
  return `version: "3.9"

services:
  ${artifact}:
    build: .
    container_name: ${artifact}
    ports:
      - "8080:8080"
    environment:
      - SPRING_PROFILES_ACTIVE=docker
      - EUREKA_CLIENT_SERVICE_URL_DEFAULTZONE=http://eureka-server:8761/eureka/
      - SPRING_CONFIG_IMPORT=optional:configserver:http://config-server:8888
    depends_on:
      - eureka-server
    networks:
      - microservices-net

  eureka-server:
    image: springcloud/eureka
    container_name: eureka-server
    ports:
      - "8761:8761"
    networks:
      - microservices-net

networks:
  microservices-net:
    driver: bridge
`;
}

// ════════════════════════════════════════════════════════════════════════════
// Test class
// ════════════════════════════════════════════════════════════════════════════
function testClass(fullPkg, className, template) {
  const isCrud = ["rest-api", "mysql", "postgres"].includes(template);

  return `package ${fullPkg};

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.*;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT)
class ${className}ApplicationTests {

    @Autowired
    private TestRestTemplate restTemplate;

    @Test
    void contextLoads() {
        // Verifies the Spring context starts without errors
    }

    @Test
    void healthEndpointReturnsOk() {
        ResponseEntity<String> response =
            restTemplate.getForEntity("/api/health", String.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    }
${
  isCrud
    ? `
    @Test
    void getItemsReturnsOkWhenEmpty() {
        ResponseEntity<String> response =
            restTemplate.getForEntity("/api/items", String.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    }
`
    : ""
}
}
`;
}

// ════════════════════════════════════════════════════════════════════════════
// Shared helpers
// ════════════════════════════════════════════════════════════════════════════
function gitignore() {
  return `target/
*.class
*.jar
*.war
*.nar
*.ear
*.zip
*.tar.gz
*.rar
.idea/
*.iml
.vscode/
.DS_Store
application-local.properties
`;
}

function readme(name, artifact, dbName, template, javaVersion, javaWarning) {
  const configs = {
    default: {
      label: "Default (Minimal)",
      prereq: "",
      dbSetup: "",
      endpoints: [
        ["GET", "/api/health", "Health check"],
        ["GET", "/api/hello?name=World", "Hello endpoint"],
        ["GET", "/actuator/health", "Spring Actuator"],
      ],
    },
    "rest-api": {
      label: "REST API + CRUD (H2 in-memory)",
      prereq: "",
      dbSetup: "",
      endpoints: [
        ["GET", "/api/items", "List all items"],
        ["GET", "/api/items/{id}", "Get item by ID"],
        ["POST", "/api/items", "Create item"],
        ["PUT", "/api/items/{id}", "Update item"],
        ["DELETE", "/api/items/{id}", "Delete item"],
        ["GET", "/api/items/search?name=…", "Search by name"],
        ["GET", `/h2-console  (JDBC: jdbc:h2:mem:${dbName})`, "H2 web console"],
      ],
    },
    mysql: {
      label: "REST API + MySQL",
      prereq: "- MySQL 8+ running on `localhost:3306`",
      dbSetup:
        `**Run this once in MySQL before starting the app:**\n\n` +
        "```sql\n" +
        `CREATE DATABASE ${dbName};\n` +
        "```\n\n" +
        `> ⚠ The app connects to **\`${dbName}\`** — using any other name will cause a startup failure.`,
      endpoints: [
        ["GET", "/api/items", "List all items"],
        ["GET", "/api/items/{id}", "Get item by ID"],
        ["POST", "/api/items", "Create item"],
        ["PUT", "/api/items/{id}", "Update item"],
        ["DELETE", "/api/items/{id}", "Delete item"],
        ["GET", "/api/items/search?name=…", "Search by name"],
      ],
    },
    postgres: {
      label: "REST API + PostgreSQL",
      prereq: "- PostgreSQL 15+ running on `localhost:5432`",
      dbSetup:
        `**Run this once in psql before starting the app:**\n\n` +
        "```sql\n" +
        `CREATE DATABASE ${dbName};\n` +
        "```\n\n" +
        `> ⚠ The app connects to **\`${dbName}\`** — using any other name will cause a startup failure.`,
      endpoints: [
        ["GET", "/api/items", "List all items"],
        ["GET", "/api/items/{id}", "Get item by ID"],
        ["POST", "/api/items", "Create item"],
        ["PUT", "/api/items/{id}", "Update item"],
        ["DELETE", "/api/items/{id}", "Delete item"],
        ["GET", "/api/items/search?name=…", "Search by name"],
      ],
    },
    microservice: {
      label: "Microservice (Eureka + Config + Feign)",
      prereq:
        "- Eureka Server running on `localhost:8761`\n" +
        "- Config Server on `localhost:8888` *(optional)*",
      dbSetup: "",
      endpoints: [
        ["GET", "/api/health", "Service health"],
        ["GET", "/api/info", "Service info"],
        [
          "GET",
          "/api/remote/health",
          "Remote health via Feign (with fallback)",
        ],
        ["GET", "/actuator/health", "Spring Actuator"],
      ],
    },
  };

  const c = configs[template] || configs["default"];
  const rows = c.endpoints
    .map(([m, p, d]) => `| ${m} | \`${p}\` | ${d} |`)
    .join("\n");

  const javaWarnSection = javaWarning
    ? `\n## ⚠ Java version warning\n\n> ${javaWarning.replace(/\n/g, "\n> ")}\n`
    : "";

  const dbSection = c.dbSetup
    ? `\n## ⚡ Database setup — required before first run\n\n${c.dbSetup}\n`
    : "";

  return `# ${name}

> Generated by **PIC-LI** — Template: **${c.label}**
${javaWarnSection}${dbSection}
## Stack

- Java ${javaVersion} + Spring Boot 3.2
- Maven${
    template === "microservice"
      ? "\n- Spring Cloud 2023.0.1 (Eureka auto-configured, OpenFeign, Resilience4j)"
      : ""
  }${
    template === "rest-api" ? "\n- H2 (in-memory, resets on every restart)" : ""
  }${template === "mysql" ? "\n- MySQL 8+" : ""}${
    template === "postgres" ? "\n- PostgreSQL 15+" : ""
  }

## Prerequisites

- Java ${javaVersion}+  →  https://adoptium.net/temurin/releases/?version=${javaVersion}
- Maven 3.9+
${c.prereq}

## Run

\`\`\`bash
mvn spring-boot:run
\`\`\`

API → **http://localhost:8080**

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
${rows}

## Build

\`\`\`bash
mvn package
java -jar target/${artifact}-0.0.1-SNAPSHOT.jar
\`\`\`
${
  template === "microservice"
    ? `
## Docker

\`\`\`bash
docker-compose up --build
\`\`\`
`
    : ""
}`;
}

function toPascal(str) {
  return str.replace(/(?:^|[-_\s])(\w)/g, (_, c) => c.toUpperCase());
}

module.exports = { generate };
