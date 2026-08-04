import 'package:flutter/material.dart';

PreferredSizeWidget workForgeAppBar(
  BuildContext context,
  String title, {
  bool implyLeading = true,
  List<Widget>? actions,
}) {
  final scheme = Theme.of(context).colorScheme;
  final textStyle = Theme.of(context).textTheme.titleMedium?.copyWith(
        fontSize: 20,
        fontWeight: FontWeight.w700,
        color: scheme.primary,
      );

  return AppBar(
    automaticallyImplyLeading: implyLeading,
    backgroundColor: Colors.white,
    surfaceTintColor: Colors.white,
    elevation: 0,
    centerTitle: true,
    iconTheme: IconThemeData(color: scheme.primary),
    title: Text(title, style: textStyle),
    actions: actions,
  );
}
