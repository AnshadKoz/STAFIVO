import 'package:flutter/material.dart';

class FaceFrameOverlay extends StatelessWidget {
  const FaceFrameOverlay({super.key, this.color});

  final Color? color;

  @override
  Widget build(BuildContext context) {
    final borderColor = color ?? Theme.of(context).colorScheme.onPrimary;
    return IgnorePointer(
      child: LayoutBuilder(
        builder: (context, constraints) {
          final width = constraints.maxWidth;
          final height = constraints.maxHeight;
          return Center(
            child: Container(
              width: width * 0.75,
              height: height * 0.7,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(32),
                border: Border.all(color: borderColor.withValues(alpha: 0.9), width: 3),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.15),
                    blurRadius: 16,
                    spreadRadius: 1,
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
