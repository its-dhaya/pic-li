"use strict";

const fs = require("fs-extra");
const path = require("path");
const { spawnSync } = require("child_process");

const isWin = process.platform === "win32";

// ─── Safe runner ──────────────────────────────────────────────────────────────
// Problem: on Windows, `flutter`, `git`, etc. are .bat / .cmd files.
// spawnSync with shell:false cannot resolve batch files from PATH — only .exe
// files — which causes ENOENT.
//
// Fix: on Windows wrap every call with  cmd.exe /c <file> [...args]
//   • cmd.exe is a real .exe, always resolvable
//   • /c tells cmd to run the command and exit
//   • passing args as an array (not a joined string) means cmd.exe receives
//     each argument verbatim — so paths that contain spaces are still safe
//
// On Unix, spawnSync resolves shell scripts from PATH fine with shell:false.
function run(file, args, { cwd, allowFail = false } = {}) {
  const spawnFile = isWin ? "cmd.exe" : file;
  const spawnArgs = isWin ? ["/c", file, ...args] : args;

  const result = spawnSync(spawnFile, spawnArgs, {
    cwd,
    stdio: "pipe",
    shell: false, // no shell expansion — spaces in cwd/args are safe
    windowsHide: true,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (!allowFail && result.status !== 0) {
    const msg = ((result.stderr || "") + (result.stdout || "")).trim();
    throw new Error(msg || `Process exited with code ${result.status}`);
  }
  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const w = (filePath, content) => {
  fs.ensureDirSync(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
};

// ─── Entry point ──────────────────────────────────────────────────────────────
async function generate({ name, template, targetDir, onStep }) {
  const slug = name
    .toLowerCase()
    .replace(/[\s-]/g, "_")
    .replace(/[^a-z0-9_]/g, "");

  const parentDir = path.dirname(targetDir);

  // ── 1. flutter create ───────────────────────────────────────────────────────
  onStep("Running flutter create");
  run(
    "flutter",
    ["create", "--org", "com.example", "--project-name", slug, slug],
    {
      cwd: parentDir,
    }
  );

  // Move to targetDir if flutter created a sibling folder
  const created = path.join(parentDir, slug);
  if (created !== targetDir && fs.existsSync(created)) {
    fs.moveSync(created, targetDir, { overwrite: true });
  }

  // ── 2. Add packages ─────────────────────────────────────────────────────────
  onStep("Adding packages");
  if (template === "with-provider") {
    run("flutter", ["pub", "add", "provider", "http", "shared_preferences"], {
      cwd: targetDir,
    });
  }
  if (template === "with-riverpod") {
    run(
      "flutter",
      [
        "pub",
        "add",
        "flutter_riverpod",
        "hooks_riverpod",
        "flutter_hooks",
        "http",
        "freezed_annotation",
      ],
      { cwd: targetDir }
    );
    run(
      "flutter",
      ["pub", "add", "--dev", "build_runner", "freezed", "riverpod_generator"],
      { cwd: targetDir, allowFail: true }
    );
  }
  if (template === "with-bloc") {
    run("flutter", ["pub", "add", "flutter_bloc", "equatable", "http"], {
      cwd: targetDir,
    });
  }

  // ── 3. Scaffold lib/ structure ──────────────────────────────────────────────
  onStep("Scaffolding project structure");
  if (template === "default") scaffoldDefault(targetDir, name, slug);
  else if (template === "with-provider")
    scaffoldProvider(targetDir, name, slug);
  else if (template === "with-riverpod")
    scaffoldRiverpod(targetDir, name, slug);
  else if (template === "with-bloc") scaffoldBloc(targetDir, name, slug);

  // ── 4. Git + README ─────────────────────────────────────────────────────────
  onStep("Initializing Git");
  run("git", ["init"], { cwd: targetDir, allowFail: true });

  onStep("Writing README");
  w(path.join(targetDir, "README.md"), readme(name, template));
}

// =============================================================================
// TEMPLATE 1 — default
// =============================================================================
//
// lib/
// ├── main.dart
// ├── app.dart
// ├── core/
// │   ├── constants/app_constants.dart
// │   ├── theme/app_theme.dart
// │   └── utils/helpers.dart
// ├── screens/
// │   └── home_screen.dart
// ├── widgets/
// │   └── custom_button.dart
// └── models/
//     └── item_model.dart

function scaffoldDefault(dir, name, slug) {
  const lib = path.join(dir, "lib");

  w(
    path.join(lib, "main.dart"),
    `import 'package:flutter/material.dart';
import 'app.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const MyApp());
}
`
  );

  w(
    path.join(lib, "app.dart"),
    `import 'package:flutter/material.dart';
import 'core/theme/app_theme.dart';
import 'screens/home_screen.dart';

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '${name}',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      themeMode: ThemeMode.system,
      home: const HomeScreen(),
    );
  }
}
`
  );

  w(
    path.join(lib, "core", "constants", "app_constants.dart"),
    `class AppConstants {
  AppConstants._();

  static const String appName    = '${name}';
  static const String appVersion = '1.0.0';
  static const String baseUrl    = 'https://api.example.com';
}
`
  );

  w(
    path.join(lib, "core", "theme", "app_theme.dart"),
    `import 'package:flutter/material.dart';

class AppTheme {
  AppTheme._();

  static final light = ThemeData(
    colorSchemeSeed: Colors.indigo,
    useMaterial3:    true,
    brightness:      Brightness.light,
  );

  static final dark = ThemeData(
    colorSchemeSeed: Colors.indigo,
    useMaterial3:    true,
    brightness:      Brightness.dark,
  );
}
`
  );

  w(
    path.join(lib, "core", "utils", "helpers.dart"),
    `import 'package:flutter/material.dart';

void showSnackBar(BuildContext context, String message) {
  ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content: Text(message)),
  );
}

bool isNullOrEmpty(String? value) => value == null || value.trim().isEmpty;
`
  );

  w(
    path.join(lib, "screens", "home_screen.dart"),
    `import 'package:flutter/material.dart';
import '../widgets/custom_button.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('${name}')),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              '${name}',
              style: Theme.of(context)
                  .textTheme
                  .headlineMedium
                  ?.copyWith(fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            const Text('Generated by PIC-LI',
                style: TextStyle(color: Colors.grey)),
            const SizedBox(height: 32),
            CustomButton(
              label:     'Get Started',
              onPressed: () {},
            ),
          ],
        ),
      ),
    );
  }
}
`
  );

  w(
    path.join(lib, "widgets", "custom_button.dart"),
    `import 'package:flutter/material.dart';

class CustomButton extends StatelessWidget {
  const CustomButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.isLoading = false,
  });

  final String       label;
  final VoidCallback onPressed;
  final bool         isLoading;

  @override
  Widget build(BuildContext context) {
    return ElevatedButton(
      onPressed: isLoading ? null : onPressed,
      style: ElevatedButton.styleFrom(
        padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 14),
      ),
      child: isLoading
          ? const SizedBox(
              width: 20, height: 20,
              child: CircularProgressIndicator(strokeWidth: 2))
          : Text(label),
    );
  }
}
`
  );

  w(
    path.join(lib, "models", "item_model.dart"),
    `class ItemModel {
  const ItemModel({
    required this.id,
    required this.title,
    this.description = '',
  });

  final int    id;
  final String title;
  final String description;

  factory ItemModel.fromJson(Map<String, dynamic> json) => ItemModel(
        id:          json['id']          as int,
        title:       json['title']       as String,
        description: json['description'] as String? ?? '',
      );

  Map<String, dynamic> toJson() => {
        'id':          id,
        'title':       title,
        'description': description,
      };

  @override
  String toString() => 'ItemModel(id: \$id, title: \$title)';
}
`
  );
}

// =============================================================================
// TEMPLATE 2 — with-provider
// =============================================================================
//
// lib/
// ├── main.dart
// ├── app.dart
// ├── core/
// │   └── theme/app_theme.dart
// ├── models/
// │   └── user_model.dart
// ├── providers/
// │   ├── auth_provider.dart
// │   └── counter_provider.dart
// ├── services/
// │   └── api_service.dart
// ├── screens/
// │   └── home_screen.dart
// └── widgets/
//     └── custom_button.dart

function scaffoldProvider(dir, name, slug) {
  const lib = path.join(dir, "lib");

  w(
    path.join(lib, "main.dart"),
    `import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'app.dart';
import 'providers/auth_provider.dart';
import 'providers/counter_provider.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider()),
        ChangeNotifierProvider(create: (_) => CounterProvider()),
      ],
      child: const MyApp(),
    ),
  );
}
`
  );

  w(
    path.join(lib, "app.dart"),
    `import 'package:flutter/material.dart';
import 'core/theme/app_theme.dart';
import 'screens/home_screen.dart';

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '${name}',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      themeMode: ThemeMode.system,
      home: const HomeScreen(),
    );
  }
}
`
  );

  w(
    path.join(lib, "core", "theme", "app_theme.dart"),
    `import 'package:flutter/material.dart';

class AppTheme {
  AppTheme._();

  static final light = ThemeData(
    colorSchemeSeed: Colors.indigo,
    useMaterial3:    true,
    brightness:      Brightness.light,
  );

  static final dark = ThemeData(
    colorSchemeSeed: Colors.indigo,
    useMaterial3:    true,
    brightness:      Brightness.dark,
  );
}
`
  );

  w(
    path.join(lib, "models", "user_model.dart"),
    `class UserModel {
  const UserModel({
    required this.id,
    required this.email,
    this.displayName = '',
  });

  final String id;
  final String email;
  final String displayName;

  factory UserModel.fromJson(Map<String, dynamic> json) => UserModel(
        id:          json['id']          as String,
        email:       json['email']       as String,
        displayName: json['displayName'] as String? ?? '',
      );

  Map<String, dynamic> toJson() => {
        'id':          id,
        'email':       email,
        'displayName': displayName,
      };
}
`
  );

  w(
    path.join(lib, "providers", "auth_provider.dart"),
    `import 'package:flutter/foundation.dart';
import '../models/user_model.dart';
import '../services/api_service.dart';

enum AuthStatus { initial, loading, authenticated, unauthenticated, error }

class AuthProvider extends ChangeNotifier {
  final _api = ApiService();

  AuthStatus _status = AuthStatus.initial;
  UserModel? _user;
  String     _error  = '';

  AuthStatus get status => _status;
  UserModel? get user   => _user;
  String     get error  => _error;
  bool get isAuth       => _status == AuthStatus.authenticated;

  Future<void> login(String email, String password) async {
    _status = AuthStatus.loading;
    _error  = '';
    notifyListeners();
    try {
      _user   = await _api.login(email, password);
      _status = AuthStatus.authenticated;
    } catch (e) {
      _error  = e.toString();
      _status = AuthStatus.error;
    }
    notifyListeners();
  }

  void logout() {
    _user   = null;
    _status = AuthStatus.unauthenticated;
    notifyListeners();
  }
}
`
  );

  w(
    path.join(lib, "providers", "counter_provider.dart"),
    `import 'package:flutter/foundation.dart';

class CounterProvider extends ChangeNotifier {
  int _count = 0;

  int get count => _count;

  void increment() { _count++;                              notifyListeners(); }
  void decrement() { if (_count > 0) { _count--; }         notifyListeners(); }
  void reset()     { _count = 0;                           notifyListeners(); }
}
`
  );

  w(
    path.join(lib, "services", "api_service.dart"),
    `import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/user_model.dart';

class ApiService {
  static const _base = 'https://api.example.com';

  Future<UserModel> login(String email, String password) async {
    final response = await http.post(
      Uri.parse('\$_base/auth/login'),
      headers: {'Content-Type': 'application/json'},
      body:    jsonEncode({'email': email, 'password': password}),
    );
    if (response.statusCode == 200) {
      return UserModel.fromJson(
          jsonDecode(response.body) as Map<String, dynamic>);
    }
    throw Exception('Login failed: \${response.statusCode}');
  }

  Future<List<Map<String, dynamic>>> fetchItems() async {
    final response = await http.get(Uri.parse('\$_base/items'));
    if (response.statusCode == 200) {
      return List<Map<String, dynamic>>.from(
          jsonDecode(response.body) as List);
    }
    throw Exception('Failed to load items: \${response.statusCode}');
  }
}
`
  );

  w(
    path.join(lib, "screens", "home_screen.dart"),
    `import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/counter_provider.dart';
import '../providers/auth_provider.dart';
import '../widgets/custom_button.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final counter = context.watch<CounterProvider>();
    final auth    = context.watch<AuthProvider>();

    return Scaffold(
      appBar: AppBar(
        title: const Text('${name}'),
        actions: [
          if (auth.isAuth)
            IconButton(
              icon:      const Icon(Icons.logout),
              onPressed: () => context.read<AuthProvider>().logout(),
            ),
        ],
      ),
      body: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text('\${counter.count}',
                style: Theme.of(context).textTheme.displayMedium),
            const SizedBox(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                CustomButton(
                  label:     '-',
                  onPressed: () => context.read<CounterProvider>().decrement(),
                ),
                const SizedBox(width: 16),
                CustomButton(
                  label:     '+',
                  onPressed: () => context.read<CounterProvider>().increment(),
                ),
              ],
            ),
            const SizedBox(height: 16),
            TextButton(
              onPressed: () => context.read<CounterProvider>().reset(),
              child: const Text('Reset'),
            ),
          ],
        ),
      ),
    );
  }
}
`
  );

  w(
    path.join(lib, "widgets", "custom_button.dart"),
    `import 'package:flutter/material.dart';

class CustomButton extends StatelessWidget {
  const CustomButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.isLoading = false,
  });

  final String       label;
  final VoidCallback onPressed;
  final bool         isLoading;

  @override
  Widget build(BuildContext context) {
    return ElevatedButton(
      onPressed: isLoading ? null : onPressed,
      style: ElevatedButton.styleFrom(
        padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 12),
      ),
      child: isLoading
          ? const SizedBox(
              width: 18, height: 18,
              child: CircularProgressIndicator(strokeWidth: 2))
          : Text(label),
    );
  }
}
`
  );
}

// =============================================================================
// TEMPLATE 3 — with-riverpod
// =============================================================================
//
// lib/
// ├── main.dart
// ├── app.dart
// ├── core/
// │   ├── constants/app_constants.dart
// │   └── theme/app_theme.dart
// ├── features/
// │   └── home/
// │       ├── data/home_repository.dart
// │       ├── domain/home_model.dart
// │       └── presentation/
// │           ├── home_screen.dart
// │           └── home_provider.dart
// ├── providers/
// │   ├── app_providers.dart
// │   └── auth_provider.dart
// ├── services/
// │   └── api_service.dart
// └── widgets/
//     └── custom_button.dart

function scaffoldRiverpod(dir, name, slug) {
  const lib = path.join(dir, "lib");

  w(
    path.join(lib, "main.dart"),
    `import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    const ProviderScope(
      child: MyApp(),
    ),
  );
}
`
  );

  w(
    path.join(lib, "app.dart"),
    `import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'core/theme/app_theme.dart';
import 'features/home/presentation/home_screen.dart';

class MyApp extends ConsumerWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp(
      title: '${name}',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      themeMode: ThemeMode.system,
      home: const HomeScreen(),
    );
  }
}
`
  );

  w(
    path.join(lib, "core", "constants", "app_constants.dart"),
    `class AppConstants {
  AppConstants._();

  static const String appName    = '${name}';
  static const String appVersion = '1.0.0';
  static const String baseUrl    = 'https://api.example.com';
}
`
  );

  w(
    path.join(lib, "core", "theme", "app_theme.dart"),
    `import 'package:flutter/material.dart';

class AppTheme {
  AppTheme._();

  static final light = ThemeData(
    colorSchemeSeed: Colors.deepPurple,
    useMaterial3:    true,
    brightness:      Brightness.light,
  );

  static final dark = ThemeData(
    colorSchemeSeed: Colors.deepPurple,
    useMaterial3:    true,
    brightness:      Brightness.dark,
  );
}
`
  );

  w(
    path.join(lib, "features", "home", "data", "home_repository.dart"),
    `import 'dart:convert';
import 'package:http/http.dart' as http;
import '../domain/home_model.dart';
import '../../../core/constants/app_constants.dart';

class HomeRepository {
  Future<List<HomeModel>> fetchItems() async {
    final response = await http.get(
      Uri.parse('\${AppConstants.baseUrl}/items'),
    );
    if (response.statusCode == 200) {
      final List<dynamic> data = jsonDecode(response.body) as List;
      return data
          .map((e) => HomeModel.fromJson(e as Map<String, dynamic>))
          .toList();
    }
    throw Exception('Failed to fetch items: \${response.statusCode}');
  }
}
`
  );

  w(
    path.join(lib, "features", "home", "domain", "home_model.dart"),
    `class HomeModel {
  const HomeModel({
    required this.id,
    required this.title,
    this.body = '',
  });

  final int    id;
  final String title;
  final String body;

  factory HomeModel.fromJson(Map<String, dynamic> json) => HomeModel(
        id:    json['id']    as int,
        title: json['title'] as String,
        body:  json['body']  as String? ?? '',
      );

  Map<String, dynamic> toJson() => {'id': id, 'title': title, 'body': body};
}
`
  );

  w(
    path.join(lib, "features", "home", "presentation", "home_provider.dart"),
    `import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/home_repository.dart';
import '../domain/home_model.dart';

final homeRepositoryProvider = Provider<HomeRepository>((ref) {
  return HomeRepository();
});

final homeItemsProvider = FutureProvider<List<HomeModel>>((ref) async {
  final repo = ref.watch(homeRepositoryProvider);
  return repo.fetchItems();
});
`
  );

  w(
    path.join(lib, "features", "home", "presentation", "home_screen.dart"),
    `import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'home_provider.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final itemsAsync = ref.watch(homeItemsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('${name}')),
      body: itemsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error:   (err, _) => Center(child: Text('Error: \$err')),
        data:    (items) => ListView.builder(
          itemCount: items.length,
          itemBuilder: (ctx, i) => ListTile(
            leading:  CircleAvatar(child: Text('\${items[i].id}')),
            title:    Text(items[i].title),
            subtitle: Text(items[i].body,
                maxLines: 1, overflow: TextOverflow.ellipsis),
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => ref.invalidate(homeItemsProvider),
        child: const Icon(Icons.refresh),
      ),
    );
  }
}
`
  );

  w(
    path.join(lib, "providers", "app_providers.dart"),
    `import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Global loading state.
final isLoadingProvider = StateProvider<bool>((ref) => false);

/// Global error message.
final errorMessageProvider = StateProvider<String?>((ref) => null);
`
  );

  w(
    path.join(lib, "providers", "auth_provider.dart"),
    `import 'package:flutter_riverpod/flutter_riverpod.dart';

class AuthState {
  const AuthState({
    this.isAuthenticated = false,
    this.userId,
    this.email,
    this.isLoading = false,
    this.error,
  });

  final bool    isAuthenticated;
  final String? userId;
  final String? email;
  final bool    isLoading;
  final String? error;

  AuthState copyWith({
    bool?    isAuthenticated,
    String?  userId,
    String?  email,
    bool?    isLoading,
    String?  error,
  }) =>
      AuthState(
        isAuthenticated: isAuthenticated ?? this.isAuthenticated,
        userId:          userId          ?? this.userId,
        email:           email           ?? this.email,
        isLoading:       isLoading       ?? this.isLoading,
        error:           error,
      );
}

class AuthNotifier extends StateNotifier<AuthState> {
  AuthNotifier() : super(const AuthState());

  Future<void> login(String email, String password) async {
    state = state.copyWith(isLoading: true, error: null);
    // Replace with your real auth call
    await Future.delayed(const Duration(milliseconds: 800));
    state = state.copyWith(
      isLoading:       false,
      isAuthenticated: true,
      email:           email,
      userId:          'user_001',
    );
  }

  void logout() => state = const AuthState();
}

final authProvider =
    StateNotifierProvider<AuthNotifier, AuthState>((ref) => AuthNotifier());
`
  );

  w(
    path.join(lib, "services", "api_service.dart"),
    `import 'dart:convert';
import 'package:http/http.dart' as http;
import '../core/constants/app_constants.dart';

class ApiService {
  const ApiService();

  Future<T> get<T>(
    String endpoint,
    T Function(dynamic json) fromJson,
  ) async {
    final response = await http.get(
        Uri.parse('\${AppConstants.baseUrl}\$endpoint'));
    if (response.statusCode == 200) return fromJson(jsonDecode(response.body));
    throw Exception('GET \$endpoint failed: \${response.statusCode}');
  }

  Future<T> post<T>(
    String endpoint,
    Map<String, dynamic> body,
    T Function(dynamic json) fromJson,
  ) async {
    final response = await http.post(
      Uri.parse('\${AppConstants.baseUrl}\$endpoint'),
      headers: {'Content-Type': 'application/json'},
      body:    jsonEncode(body),
    );
    if (response.statusCode == 200 || response.statusCode == 201) {
      return fromJson(jsonDecode(response.body));
    }
    throw Exception('POST \$endpoint failed: \${response.statusCode}');
  }
}
`
  );

  w(
    path.join(lib, "widgets", "custom_button.dart"),
    `import 'package:flutter/material.dart';

enum ButtonVariant { primary, outlined, text }

class CustomButton extends StatelessWidget {
  const CustomButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.isLoading = false,
    this.variant   = ButtonVariant.primary,
  });

  final String        label;
  final VoidCallback  onPressed;
  final bool          isLoading;
  final ButtonVariant variant;

  @override
  Widget build(BuildContext context) {
    final child = isLoading
        ? const SizedBox(
            width: 18, height: 18,
            child: CircularProgressIndicator(strokeWidth: 2))
        : Text(label);

    return switch (variant) {
      ButtonVariant.primary  => ElevatedButton(
          onPressed: isLoading ? null : onPressed, child: child),
      ButtonVariant.outlined => OutlinedButton(
          onPressed: isLoading ? null : onPressed, child: child),
      ButtonVariant.text     => TextButton(
          onPressed: isLoading ? null : onPressed, child: child),
    };
  }
}
`
  );
}

// =============================================================================
// TEMPLATE 4 — with-bloc
// =============================================================================
//
// lib/
// ├── main.dart
// ├── app.dart
// ├── core/
// │   ├── theme/app_theme.dart
// │   └── utils/helpers.dart
// ├── data/
// │   ├── models/item_model.dart
// │   └── repositories/item_repository.dart
// ├── blocs/
// │   └── counter/
// │       ├── counter_bloc.dart
// │       ├── counter_event.dart
// │       └── counter_state.dart
// ├── screens/
// │   └── home_screen.dart
// ├── widgets/
// │   └── custom_button.dart
// └── features/
//     └── auth/
//         ├── data/auth_repository.dart
//         ├── domain/auth_model.dart
//         └── presentation/
//             ├── auth_screen.dart
//             └── bloc/
//                 ├── auth_bloc.dart
//                 ├── auth_event.dart
//                 └── auth_state.dart

function scaffoldBloc(dir, name, slug) {
  const lib = path.join(dir, "lib");

  w(
    path.join(lib, "main.dart"),
    `import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'app.dart';
import 'blocs/counter/counter_bloc.dart';
import 'features/auth/data/auth_repository.dart';
import 'features/auth/presentation/bloc/auth_bloc.dart';


void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    MultiRepositoryProvider(
      providers: [
        RepositoryProvider(create: (_) => AuthRepository()),
      ],
      child: MultiBlocProvider(
        providers: [
          BlocProvider(create: (_) => CounterBloc()),
          BlocProvider(
            create: (ctx) => AuthBloc(
              authRepository: ctx.read<AuthRepository>(),
            )..add(AuthCheckStatusEvent()),
          ),
        ],
        child: const MyApp(),
      ),
    ),
  );
}
`
  );

  w(
    path.join(lib, "app.dart"),
    `import 'package:flutter/material.dart';
import 'core/theme/app_theme.dart';
import 'screens/home_screen.dart';

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '${name}',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      themeMode: ThemeMode.system,
      home: const HomeScreen(),
    );
  }
}
`
  );

  w(
    path.join(lib, "core", "theme", "app_theme.dart"),
    `import 'package:flutter/material.dart';

class AppTheme {
  AppTheme._();

  static final light = ThemeData(
    colorSchemeSeed: Colors.teal,
    useMaterial3:    true,
    brightness:      Brightness.light,
  );

  static final dark = ThemeData(
    colorSchemeSeed: Colors.teal,
    useMaterial3:    true,
    brightness:      Brightness.dark,
  );
}
`
  );

  w(
    path.join(lib, "core", "utils", "helpers.dart"),
    `import 'package:flutter/material.dart';

void showSnackBar(BuildContext context, String message) =>
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));

bool isNullOrEmpty(String? v) => v == null || v.trim().isEmpty;
`
  );

  // data layer ─────────────────────────────────────────────────────────────────
  w(
    path.join(lib, "data", "models", "item_model.dart"),
    `class ItemModel {
  const ItemModel({
    required this.id,
    required this.title,
    this.body = '',
  });

  final int    id;
  final String title;
  final String body;

  factory ItemModel.fromJson(Map<String, dynamic> json) => ItemModel(
        id:    json['id']    as int,
        title: json['title'] as String,
        body:  json['body']  as String? ?? '',
      );

  Map<String, dynamic> toJson() => {'id': id, 'title': title, 'body': body};

  @override
  String toString() => 'ItemModel(id: \$id, title: \$title)';
}
`
  );

  w(
    path.join(lib, "data", "repositories", "item_repository.dart"),
    `import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/item_model.dart';

class ItemRepository {
  static const _base = 'https://api.example.com';

  Future<List<ItemModel>> getItems() async {
    final response = await http.get(Uri.parse('\$_base/items'));
    if (response.statusCode == 200) {
      final List<dynamic> data = jsonDecode(response.body) as List;
      return data
          .map((e) => ItemModel.fromJson(e as Map<String, dynamic>))
          .toList();
    }
    throw Exception('Failed to fetch items: \${response.statusCode}');
  }

  Future<ItemModel> getItem(int id) async {
    final response = await http.get(Uri.parse('\$_base/items/\$id'));
    if (response.statusCode == 200) {
      return ItemModel.fromJson(
          jsonDecode(response.body) as Map<String, dynamic>);
    }
    throw Exception('Item \$id not found: \${response.statusCode}');
  }
}
`
  );

  // counter bloc ───────────────────────────────────────────────────────────────
  w(
    path.join(lib, "blocs", "counter", "counter_event.dart"),
    `part of 'counter_bloc.dart';

abstract class CounterEvent {}
class CounterIncrementEvent extends CounterEvent {}
class CounterDecrementEvent extends CounterEvent {}
class CounterResetEvent     extends CounterEvent {}
`
  );

  w(
    path.join(lib, "blocs", "counter", "counter_state.dart"),
    `part of 'counter_bloc.dart';

class CounterState {
  const CounterState({this.count = 0});
  final int count;
  CounterState copyWith({int? count}) =>
      CounterState(count: count ?? this.count);
}
`
  );

  w(
    path.join(lib, "blocs", "counter", "counter_bloc.dart"),
    `import 'package:flutter_bloc/flutter_bloc.dart';

part 'counter_event.dart';
part 'counter_state.dart';

class CounterBloc extends Bloc<CounterEvent, CounterState> {
  CounterBloc() : super(const CounterState()) {
    on<CounterIncrementEvent>((_, emit) =>
        emit(state.copyWith(count: state.count + 1)));
    on<CounterDecrementEvent>((_, emit) =>
        emit(state.copyWith(count: state.count > 0 ? state.count - 1 : 0)));
    on<CounterResetEvent>((_, emit) =>
        emit(const CounterState()));
  }
}
`
  );

  // screens ────────────────────────────────────────────────────────────────────
  w(
    path.join(lib, "screens", "home_screen.dart"),
    `import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../blocs/counter/counter_bloc.dart';
import '../widgets/custom_button.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('${name}')),
      body: Center(
        child: BlocBuilder<CounterBloc, CounterState>(
          builder: (context, state) {
            return Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text('\${state.count}',
                    style: Theme.of(context).textTheme.displayLarge),
                const SizedBox(height: 24),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    CustomButton(
                      label:     '-',
                      onPressed: () => context
                          .read<CounterBloc>()
                          .add(CounterDecrementEvent()),
                    ),
                    const SizedBox(width: 16),
                    CustomButton(
                      label:     '+',
                      onPressed: () => context
                          .read<CounterBloc>()
                          .add(CounterIncrementEvent()),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                TextButton(
                  onPressed: () =>
                      context.read<CounterBloc>().add(CounterResetEvent()),
                  child: const Text('Reset'),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}
`
  );

  w(
    path.join(lib, "widgets", "custom_button.dart"),
    `import 'package:flutter/material.dart';

class CustomButton extends StatelessWidget {
  const CustomButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.isLoading = false,
  });

  final String       label;
  final VoidCallback onPressed;
  final bool         isLoading;

  @override
  Widget build(BuildContext context) {
    return ElevatedButton(
      onPressed: isLoading ? null : onPressed,
      style: ElevatedButton.styleFrom(
        padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 12),
      ),
      child: isLoading
          ? const SizedBox(
              width: 18, height: 18,
              child: CircularProgressIndicator(strokeWidth: 2))
          : Text(label),
    );
  }
}
`
  );

  // features/auth/data ─────────────────────────────────────────────────────────
  w(
    path.join(lib, "features", "auth", "data", "auth_repository.dart"),
    `import '../domain/auth_model.dart';

class AuthRepository {
  /// Replace this stub with a real auth call
  /// (Firebase, Supabase, REST API, etc.).
  Future<AuthModel> login(String email, String password) async {
    await Future.delayed(const Duration(milliseconds: 800));
    if (password.length < 6) throw Exception('Password must be 6+ characters');
    return AuthModel(
      id:          'uid_001',
      email:       email,
      displayName: email.split('@').first,
    );
  }

  Future<void> logout() async =>
      Future.delayed(const Duration(milliseconds: 300));
}
`
  );

  // features/auth/domain ───────────────────────────────────────────────────────
  w(
    path.join(lib, "features", "auth", "domain", "auth_model.dart"),
    `class AuthModel {
  const AuthModel({
    required this.id,
    required this.email,
    this.displayName = '',
  });

  final String id;
  final String email;
  final String displayName;
}
`
  );

  // features/auth/presentation/bloc ───────────────────────────────────────────
  w(
    path.join(
      lib,
      "features",
      "auth",
      "presentation",
      "bloc",
      "auth_event.dart"
    ),
    `part of 'auth_bloc.dart';

abstract class AuthEvent {}

class AuthCheckStatusEvent extends AuthEvent {}

class AuthLoginEvent extends AuthEvent {
  AuthLoginEvent({required this.email, required this.password});
  final String email;
  final String password;
}

class AuthLogoutEvent extends AuthEvent {}
`
  );

  w(
    path.join(
      lib,
      "features",
      "auth",
      "presentation",
      "bloc",
      "auth_state.dart"
    ),
    `part of 'auth_bloc.dart';

enum AuthStatus { initial, loading, authenticated, unauthenticated, failure }

class AuthState {
  const AuthState({
    this.status       = AuthStatus.initial,
    this.userId,
    this.email,
    this.displayName,
    this.errorMessage,
  });

  final AuthStatus status;
  final String?    userId;
  final String?    email;
  final String?    displayName;
  final String?    errorMessage;

  bool get isAuthenticated => status == AuthStatus.authenticated;

  AuthState copyWith({
    AuthStatus? status,
    String?     userId,
    String?     email,
    String?     displayName,
    String?     errorMessage,
  }) =>
      AuthState(
        status:       status       ?? this.status,
        userId:       userId       ?? this.userId,
        email:        email        ?? this.email,
        displayName:  displayName  ?? this.displayName,
        errorMessage: errorMessage,
      );
}
`
  );

  w(
    path.join(
      lib,
      "features",
      "auth",
      "presentation",
      "bloc",
      "auth_bloc.dart"
    ),
    `import 'package:flutter_bloc/flutter_bloc.dart';
import '../../data/auth_repository.dart';
import '../../domain/auth_model.dart';

part 'auth_event.dart';
part 'auth_state.dart';

class AuthBloc extends Bloc<AuthEvent, AuthState> {
  AuthBloc({required this.authRepository}) : super(const AuthState()) {
    on<AuthCheckStatusEvent>(_onCheckStatus);
    on<AuthLoginEvent>(_onLogin);
    on<AuthLogoutEvent>(_onLogout);
  }

  final AuthRepository authRepository;

  Future<void> _onCheckStatus(
      AuthCheckStatusEvent event, Emitter<AuthState> emit) async {
    emit(state.copyWith(status: AuthStatus.unauthenticated));
  }

  Future<void> _onLogin(
      AuthLoginEvent event, Emitter<AuthState> emit) async {
    emit(state.copyWith(status: AuthStatus.loading));
    try {
      final AuthModel user =
          await authRepository.login(event.email, event.password);
      emit(state.copyWith(
        status:      AuthStatus.authenticated,
        userId:      user.id,
        email:       user.email,
        displayName: user.displayName,
      ));
    } catch (e) {
      emit(state.copyWith(
        status:       AuthStatus.failure,
        errorMessage: e.toString(),
      ));
    }
  }

  Future<void> _onLogout(
      AuthLogoutEvent event, Emitter<AuthState> emit) async {
    await authRepository.logout();
    emit(const AuthState(status: AuthStatus.unauthenticated));
  }
}
`
  );

  // features/auth/presentation/auth_screen ────────────────────────────────────
  w(
    path.join(lib, "features", "auth", "presentation", "auth_screen.dart"),
    `import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'bloc/auth_bloc.dart';
import 'bloc/auth_event.dart';
import 'bloc/auth_state.dart';

class AuthScreen extends StatefulWidget {
  const AuthScreen({super.key});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _emailCtrl    = TextEditingController();
  final _passwordCtrl = TextEditingController();
  final _formKey      = GlobalKey<FormState>();

  @override
  void dispose() {
    _emailCtrl.dispose();
    _passwordCtrl.dispose();
    super.dispose();
  }

  void _submit() {
    if (!_formKey.currentState!.validate()) return;
    context.read<AuthBloc>().add(AuthLoginEvent(
          email:    _emailCtrl.text.trim(),
          password: _passwordCtrl.text,
        ));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sign In')),
      body: BlocListener<AuthBloc, AuthState>(
        listener: (context, state) {
          if (state.status == AuthStatus.failure) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(state.errorMessage ?? 'Auth failed')),
            );
          }
        },
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Form(
            key: _formKey,
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                TextFormField(
                  controller:   _emailCtrl,
                  decoration:   const InputDecoration(labelText: 'Email'),
                  keyboardType: TextInputType.emailAddress,
                  validator: (v) =>
                      v == null || !v.contains('@') ? 'Enter a valid email' : null,
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller:  _passwordCtrl,
                  decoration:  const InputDecoration(labelText: 'Password'),
                  obscureText: true,
                  validator: (v) =>
                      v == null || v.length < 6 ? 'Min 6 characters' : null,
                ),
                const SizedBox(height: 32),
                BlocBuilder<AuthBloc, AuthState>(
                  builder: (context, state) => ElevatedButton(
                    onPressed: state.status == AuthStatus.loading ? null : _submit,
                    style: ElevatedButton.styleFrom(
                      minimumSize: const Size.fromHeight(48),
                    ),
                    child: state.status == AuthStatus.loading
                        ? const CircularProgressIndicator()
                        : const Text('Sign In'),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
`
  );
}

// =============================================================================
// README
// =============================================================================

function readme(name, template) {
  const sections = {
    default: `## Structure
\`\`\`
lib/
├── main.dart            # Entry point
├── app.dart             # MaterialApp + routing
├── core/
│   ├── constants/       # App-wide constants
│   ├── theme/           # Light & dark AppTheme
│   └── utils/           # Shared helper functions
├── screens/             # Full-page widgets
├── widgets/             # Reusable UI components
└── models/              # Pure data classes
\`\`\``,

    "with-provider": `## Structure
\`\`\`
lib/
├── main.dart            # MultiProvider root
├── app.dart             # MaterialApp
├── core/theme/          # AppTheme
├── models/              # Data classes (UserModel …)
├── providers/           # ChangeNotifier providers
│   ├── auth_provider.dart
│   └── counter_provider.dart
├── services/            # HTTP / API layer
├── screens/             # Full-page widgets
└── widgets/             # Reusable UI components
\`\`\`

## State management
Provider — add new \`ChangeNotifierProvider\` entries in \`main.dart\`.`,

    "with-riverpod": `## Structure
\`\`\`
lib/
├── main.dart                        # ProviderScope root
├── app.dart                         # ConsumerWidget MaterialApp
├── core/constants/ theme/           # Constants + AppTheme
├── features/home/                   # Feature-first layout
│   ├── data/home_repository.dart    # Data source
│   ├── domain/home_model.dart       # Domain model
│   └── presentation/
│       ├── home_screen.dart         # ConsumerWidget screen
│       └── home_provider.dart       # FutureProvider
├── providers/                       # Global providers
├── services/api_service.dart        # Shared HTTP wrapper
└── widgets/                         # Reusable components
\`\`\`

## State management
Riverpod — after adding \`@riverpod\` annotations run:
\`\`\`bash
dart run build_runner watch
\`\`\``,

    "with-bloc": `## Structure
\`\`\`
lib/
├── main.dart                        # MultiBlocProvider + MultiRepositoryProvider
├── app.dart                         # MaterialApp
├── core/theme/ utils/               # AppTheme + helpers
├── data/
│   ├── models/item_model.dart
│   └── repositories/item_repository.dart
├── blocs/counter/                   # CounterBloc (event / state / bloc)
├── features/auth/                   # Auth feature slice
│   ├── data/auth_repository.dart
│   ├── domain/auth_model.dart
│   └── presentation/
│       ├── auth_screen.dart
│       └── bloc/                    # AuthBloc (event / state / bloc)
├── screens/home_screen.dart
└── widgets/custom_button.dart
\`\`\`

## State management
flutter_bloc — dispatch events with \`context.read<XBloc>().add(XEvent())\`.`,
  };

  return `# ${name}

Generated by **PIC-LI** · Template: \`${template}\`

## Quick start

\`\`\`bash
flutter pub get
flutter run
\`\`\`

${sections[template] || ""}

## Tests

\`\`\`bash
flutter test
\`\`\`
`;
}

module.exports = { generate };
