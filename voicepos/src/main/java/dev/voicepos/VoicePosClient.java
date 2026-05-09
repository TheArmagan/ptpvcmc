package dev.voicepos;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.Minecraft;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.phys.Vec3;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Properties;

public class VoicePosClient implements ClientModInitializer {

    private static final int SEND_INTERVAL_TICKS = 1;

    private String endpoint = "http://localhost:7270/positions";
    private double range = 96.0;

    private final HttpClient http = HttpClient.newHttpClient();
    private int tickCounter = 0;

    @Override
    public void onInitializeClient() {
        loadConfig();
        ClientTickEvents.END_CLIENT_TICK.register(this::onTick);
    }

    private void loadConfig() {
        Path configFile = FabricLoader.getInstance().getConfigDir().resolve("voicepos.properties");
        Properties props = new Properties();

        if (!Files.exists(configFile)) {
            // write defaults so the user can edit the file
            props.setProperty("endpoint", endpoint);
            props.setProperty("range", String.valueOf((int) range));
            try (OutputStream out = Files.newOutputStream(configFile)) {
                props.store(out, "voicepos config — set endpoint to your host's IP:port");
            } catch (IOException e) {
                System.err.println("[voicepos] could not write default config: " + e.getMessage());
            }
            return;
        }

        try (InputStream in = Files.newInputStream(configFile)) {
            props.load(in);
            endpoint = props.getProperty("endpoint", endpoint).trim();
            range = Double.parseDouble(props.getProperty("range", String.valueOf((int) range)).trim());
        } catch (IOException | NumberFormatException e) {
            System.err.println("[voicepos] could not read config, using defaults: " + e.getMessage());
        }
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
            if (other.distanceTo(self) > range) continue;
            Vec3 pos = other.position();
            nearbyJson.add(String.format(Locale.ROOT,
                "{\"name\":\"%s\",\"x\":%.2f,\"y\":%.2f,\"z\":%.2f}",
                other.getName().getString(), pos.x, pos.y, pos.z
            ));
        }

        // build full json payload
        String json = String.format(Locale.ROOT,
            "{\"self\":{\"name\":\"%s\",\"x\":%.2f,\"y\":%.2f,\"z\":%.2f,\"yaw\":%.2f}," +
            "\"nearby\":[%s]}",
            self.getName().getString(),
            selfPos.x, selfPos.y, selfPos.z,
            self.getYRot(),
            String.join(",", nearbyJson)
        );

        // fire and forget — don't block the game thread
        HttpRequest request = HttpRequest.newBuilder()
            .uri(URI.create(endpoint))
            .header("Content-Type", "application/json")
            .POST(HttpRequest.BodyPublishers.ofString(json))
            .build();

        http.sendAsync(request, HttpResponse.BodyHandlers.discarding())
            .exceptionally(e -> null); // silently ignore if server not running
    }
}
