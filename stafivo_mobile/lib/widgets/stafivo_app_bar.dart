import 'package:flutter/material.dart';

/// STAFIVO branded AppBar factory.
/// Built by Pent 26.
///
/// Usage: `appBar: stafivoAppBar(context, 'Screen Title')`
PreferredSizeWidget stafivoAppBar(
  BuildContext context,
  String title, {
  bool implyLeading = true,
  Widget? leading,
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
    leading: leading,
    backgroundColor: Colors.white,
    surfaceTintColor: Colors.white,
    elevation: 0,
    centerTitle: true,
    iconTheme: IconThemeData(color: scheme.primary),
    title: Text(title, style: textStyle),
    actions: actions,
  );
}

// Legacy alias — remove after all call sites are updated.
// ignore: non_constant_identifier_names
PreferredSizeWidget workForgeAppBar(
  BuildContext context,
  String title, {
  bool implyLeading = true,
  List<Widget>? actions,
}) =>
    stafivoAppBar(context, title, implyLeading: implyLeading, actions: actions);
