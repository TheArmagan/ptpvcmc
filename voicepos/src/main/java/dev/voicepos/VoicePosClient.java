package dev.voicepos;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.Minecraft;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.phys.Vec3;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.List;

public class VoicePosClient implements ClientModInitializer {

    // how often to send (every N ticks, 20 ticks = 1 second)
    private static final int SEND_INTERVAL_TICKS = 1;
    // max range to pick up other players (blocks)
    private static final double RANGE = 96.0;
    // your localhost app's endpoint
    private static final String ENDPOINT = "http://localhost:7270/positions";

    private final HttpClient http = HttpClient.newHttpClient();
    private int tickCounter = 0;

    @Override
    public void onInitializeClient() {
        ClientTickEvents.END_CLIENT_TICK.register(this::onTick);
    }

    private void onTick(Minecraft client) {
        if (client.player == null || client.level == null) return;

        tickCounter++;
        if (tickCounter < SEND_INTERVAL_TICKS) return;
        tickCounter = 0;

        Player self = client.player;
        Vec3 selfPos = self.position();

        // build nearby players list
        List<String> nearbyJson = new ArrayList<>();
        for (Player other : client.level.players()) {
            if (other == self) continue;
            if (other.distanceTo(self) > RANGE) continue;
            Vec3 pos = other.position();
            nearbyJson.add(String.format(
                "{\"name\":\"%s\",\"x\":%.2f,\"y\":%.2f,\"z\":%.2f}",
                other.getName().getString(), pos.x, pos.y, pos.z
            ));
        }

        // build full json payload
        String json = String.format(
            "{\"self\":{\"name\":\"%s\",\"x\":%.2f,\"y\":%.2f,\"z\":%.2f,\"yaw\":%.2f}," +
            "\"nearby\":[%s]}",
            self.getName().getString(),
            selfPos.x, selfPos.y, selfPos.z,
            self.getYRot(),
            String.join(",", nearbyJson)
        );

        // fire and forget — don't block the game thread
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(ENDPOINT))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(json))
            .build();

        http.sendAsync(request, HttpResponse.BodyHandlers.discarding())
            .exceptionally(e -> null); // silently ignore if server not running
    }
}
